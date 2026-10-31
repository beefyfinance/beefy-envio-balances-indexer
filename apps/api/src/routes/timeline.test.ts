import { gunzipSync } from 'node:zlib';

import * as R from 'remeda';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { cloudflareRanges, parseCidr } from '../http/clientIp.ts';
import { createMetrics } from '../http/metrics.ts';
import { createRateLimiter } from '../http/rateLimit.ts';
import type { PricedRow } from '../timeline/build.ts';
import { type TimelineRepository, TimelineTooLargeError } from '../timeline/repository.ts';
import { createTimelineService } from '../timeline/service.ts';

const ACCOUNT = '0x00000000000000000000000000000000000000aa';
const VAULT = '0x00000000000000000000000000000000000000bb';

const row = (atMs: number, delta: string): PricedRow => ({
    chain_id: 8453,
    timestamp_ms: String(atMs),
    block_number: '100',
    log_index: 1,
    trx_hash: `0x${atMs}`,
    kind: 'BALANCE',
    contract: VAULT,
    source: 'TRANSFER',
    delta,
    shares_after: delta,
    amount0: '0',
    amount1: '0',
    reward_token: '',
    reward_amount: '0',
    product_address: VAULT,
    product_kind: 'VAULT',
    contract_kind: 'VAULT',
    decimals: 18,
    share_to_usd: 2,
    price_flag: 'OK',
    price_source: 'test',
    price_resolution: '5m',
    price_before_at: atMs / 1000,
    price_after_at: null,
    usd_delta: 2,
    usd_after: 2,
});

type Setup = {
    rows?: PricedRow[];
    fail?: boolean;
    tooLarge?: boolean;
    missBurst?: number;
    clientMissBurst?: number;
    clientBurst?: number;
    blocked?: string[];
};

const setup = ({
    rows = [],
    tooLarge = false,
    missBurst = 100,
    clientMissBurst = 1000,
    clientBurst = 1000,
    blocked = [],
}: Setup = {}) => {
    let time = Date.parse('2026-10-26T12:00:00Z');
    const state = { calls: 0, fail: false, rows, version: 1 as number | undefined };
    const repository: TimelineRepository = {
        rows: async () => {
            state.calls += 1;
            await Promise.resolve();
            if (state.fail) throw new Error('clickhouse down');
            if (tooLarge) throw new TimelineTooLargeError(10_000);
            return state.rows;
        },
        productContracts: () => Promise.resolve([]),
    };
    const service = createTimelineService({
        repository,
        cacheBytes: 1_000_000,
        missesPerMinute: 60,
        missBurst,
        clientMissesPerMinute: 60,
        clientMissBurst,
        maxInFlight: 4,
        maxQueue: 4,
        maxQueueWaitMs: 50,
        version: () => state.version,
        now: () => time,
        random: () => 0.5,
    });
    const metrics = createMetrics();
    const app = createApp({
        timeline: {
            metrics,
            service,
            blocked: () => new Set(blocked),
            clientLimiter: createRateLimiter({ ratePerMinute: 60, burst: clientBurst, now: () => time }),
            // no socket under app.request: the client is the last X-Forwarded-For entry, as behind Heroku's router
            clientIp: { source: 'heroku-cloudflare', cloudflare: cloudflareRanges().map(parseCidr) },
        },
    });
    return { app, state, metrics, advance: (ms: number) => (time += ms) };
};

const timeline = (address = ACCOUNT) => `/v1/users/${address}/timeline`;

describe('GET /v1/users/{address}/timeline', () => {
    it('returns the whole history as one cacheable response, with the short policy for an active user', async () => {
        const { app } = setup({ rows: [row(Date.parse('2026-10-26T11:50:00Z'), '1000000000000000000')] });
        const response = await app.request(timeline());
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe(
            'public, max-age=5, s-maxage=5, stale-while-revalidate=5, stale-if-error=3600'
        );
        expect(response.headers.get('x-cache')).toBe('MISS');
        expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{32}"$/);
        const body = (await response.json()) as {
            address: string;
            count: number;
            items: { share_balance: string; usd_balance: number }[];
        };
        expect(body).toMatchObject({ address: ACCOUNT, count: 1 });
        expect(body.items[0]).toMatchObject({ share_balance: '1', usd_balance: 2 });
    });

    it('compresses once and serves the compressed copy to clients that accept it', async () => {
        const { app } = setup({ rows: [row(Date.parse('2026-10-26T11:50:00Z'), '1000000000000000000')] });
        const plain = await app.request(timeline());
        const compressed = await app.request(timeline(), { headers: { 'Accept-Encoding': 'gzip, br' } });
        expect(compressed.headers.get('content-encoding')).toBe('gzip');
        expect(compressed.headers.get('vary')).toBe('Accept-Encoding');
        const unzipped = gunzipSync(Buffer.from(await compressed.arrayBuffer())).toString('utf8');
        expect(unzipped).toBe(await plain.text());
    });

    it('uses the longer policy for an idle user and a distinct one for an empty timeline', async () => {
        const idle = setup({ rows: [row(Date.parse('2026-10-20T00:00:00Z'), '1000000000000000000')] });
        expect((await idle.app.request(timeline())).headers.get('cache-control')).toContain('s-maxage=60');
        const empty = setup();
        const response = await empty.app.request(timeline());
        expect(response.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
        expect(await response.json()).toMatchObject({ count: 0, items: [] });
    });

    it('answers from memory while fresh, and revalidates with the ETag', async () => {
        const { app, state } = setup({ rows: [row(Date.parse('2026-10-26T11:50:00Z'), '1')] });
        const first = await app.request(timeline());
        const second = await app.request(timeline());
        expect(second.headers.get('x-cache')).toBe('HIT');
        expect(state.calls).toBe(1);
        const tag = first.headers.get('etag') ?? '';
        const revalidated = await app.request(timeline(), { headers: { 'If-None-Match': tag } });
        expect(revalidated.status).toBe(304);
    });

    it('never serves a timeline cached from the previous version after a switch', async () => {
        const { app, state } = setup({ rows: [row(Date.parse('2026-10-26T11:50:00Z'), '1')] });
        await app.request(timeline());
        expect((await app.request(timeline())).headers.get('x-cache')).toBe('HIT');
        state.version = 2;
        expect((await app.request(timeline())).headers.get('x-cache')).toBe('MISS');
        expect(state.calls).toBe(2);
    });

    it('shares one query between concurrent requests for the same user', async () => {
        const { app, state } = setup({ rows: [row(Date.parse('2026-10-26T11:50:00Z'), '1')] });
        const responses = await Promise.all([1, 2, 3, 4, 5].map(async () => await app.request(timeline())));
        expect(responses.every((response) => response.status === 200)).toBe(true);
        expect(state.calls).toBe(1);
    });

    it('redirects every non-canonical spelling to one URL without querying', async () => {
        const { app, state } = setup();
        const busted = await app.request(`${timeline()}?_=123`);
        expect(busted.status).toBe(308);
        expect(busted.headers.get('location')).toBe(timeline());
        const upper = await app.request(timeline(`0x${'AB'.repeat(20)}`));
        expect(upper.status).toBe(308);
        expect(upper.headers.get('location')).toBe(timeline(`0x${'ab'.repeat(20)}`));
        expect(state.calls).toBe(0);
    });

    it('rejects what is not an address, and addresses that are not users, without querying, and lets the edge keep it', async () => {
        const { app, state } = setup({ blocked: [VAULT] });
        const invalid = await app.request('/v1/users/nope/timeline');
        expect(invalid.status).toBe(400);
        expect(invalid.headers.get('cache-control')).toBe('public, max-age=86400, s-maxage=86400');
        expect((await app.request(timeline('0x0000000000000000000000000000000000000000'))).status).toBe(404);
        const contract = await app.request(timeline(VAULT));
        expect(contract.status).toBe(404);
        expect(contract.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600');
        expect(state.calls).toBe(0);
    });

    it('limits uncached requests for everyone together, but still serves cached ones', async () => {
        const { app } = setup({ missBurst: 2, rows: [row(Date.parse('2026-10-26T11:50:00Z'), '1')] });
        const addresses = [1, 2, 3].map((n) => `0x${n.toString(16).padStart(40, '0')}`);
        const statuses: number[] = [];
        for (const address of addresses) statuses.push((await app.request(timeline(address))).status);
        expect(statuses).toEqual([200, 200, 429]);
        const limited = await app.request(timeline(addresses[2]));
        expect(limited.headers.get('retry-after')).toBeTruthy();
        expect((await app.request(timeline(addresses[0]))).headers.get('x-cache')).toBe('HIT');
    });

    it('limits uncached requests per client, without taking from the shared budget', async () => {
        const { app } = setup({
            clientMissBurst: 2,
            missBurst: 3,
            rows: [row(Date.parse('2026-10-26T11:50:00Z'), '1')],
        });
        const from = (ip: string) => ({ headers: { 'X-Forwarded-For': ip } });
        const addresses = [1, 2, 3, 4].map((n) => `0x${n.toString(16).padStart(40, '0')}`);
        const statuses: number[] = [];
        for (const address of addresses)
            statuses.push((await app.request(timeline(address), from('198.51.100.1'))).status);
        expect(statuses).toEqual([200, 200, 429, 429]);
        // another client still has its own budget, and the shared one was not spent by the refused requests
        expect((await app.request(timeline(addresses[2]), from('198.51.100.2'))).status).toBe(200);
        // a cached timeline costs no budget
        expect((await app.request(timeline(addresses[0]), from('198.51.100.1'))).headers.get('x-cache')).toBe('HIT');
    });

    it('does not open the breaker for accounts that are too large', async () => {
        const { app, state } = setup({ tooLarge: true });
        for (let n = 1; n <= 6; n += 1) {
            expect((await app.request(timeline(`0x${n.toString(16).padStart(40, '0')}`))).status).toBe(413);
        }
        expect(state.calls).toBe(6);
    });

    it('refuses an account that is too large for one response, and remembers it without asking the database again', async () => {
        const { app, state } = setup({ tooLarge: true });
        const first = await app.request(timeline());
        expect(first.status).toBe(413);
        expect(first.headers.get('cache-control')).toBe('public, s-maxage=300');
        expect(((await first.json()) as { error: { message: string } }).error.message).toContain('10000');
        expect((await app.request(timeline())).status).toBe(413);
        expect(state.calls).toBe(1);
    });

    it('limits each client', async () => {
        const { app } = setup({ clientBurst: 2 });
        const statuses: number[] = [];
        for (let i = 0; i < 3; i += 1) statuses.push((await app.request(timeline())).status);
        expect(statuses).toEqual([200, 200, 429]);
    });

    it('serves an old copy when the database fails, and says so', async () => {
        const { app, state, advance } = setup({ rows: [row(Date.parse('2026-10-26T11:50:00Z'), '1')] });
        expect((await app.request(timeline())).status).toBe(200);
        state.fail = true;
        // past the fresh and stale lifetimes, inside the stale-if-error one
        advance(10 * 60_000);
        const degraded = await app.request(timeline());
        expect(degraded.status).toBe(200);
        expect(degraded.headers.get('x-cache')).toBe('ERROR-STALE');
        expect(degraded.headers.get('cache-control')).toBe('public, max-age=5, s-maxage=5, stale-if-error=3600');
    });

    it('answers 503 with Retry-After when there is nothing to fall back on', async () => {
        const { app, state } = setup();
        state.fail = true;
        const response = await app.request(timeline());
        expect(response.status).toBe(503);
        expect(response.headers.get('retry-after')).toBe('5');
        expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('counts what it did, so the metrics show hits, misses and limits', async () => {
        const { app, metrics } = setup({ clientBurst: 3, rows: [row(Date.parse('2026-10-26T11:50:00Z'), '1')] });
        await app.request(timeline());
        await app.request(timeline());
        await app.request(timeline());
        await app.request(timeline());
        const text = metrics.render({});
        expect(text).toContain('beefy_timeline_requests_total{result="miss"} 1');
        expect(text).toContain('beefy_timeline_requests_total{result="hit"} 2');
        expect(text).toContain('beefy_rate_limited_total{kind="client"} 1');
    });

    it('documents the route in the OpenAPI document', async () => {
        const { app } = setup();
        const doc = (await (await app.request('/openapi.json')).json()) as {
            paths: Record<string, unknown>;
            components: {
                schemas: {
                    TimelineItem: { properties: { price: { properties: Record<string, { enum?: string[] }> } } };
                };
            };
        };
        expect(R.keys(doc.paths)).toContain('/v1/users/{address}/timeline');
        const price = doc.components.schemas.TimelineItem.properties.price.properties;
        expect(price['flag']?.enum).toEqual(['OK', 'PROVISIONAL', 'EXTRAPOLATED', 'STALE', 'MISSING', 'PENDING']);
        expect(price['resolution']?.enum).toEqual(['5m', 'latest', null]);
    });
});
