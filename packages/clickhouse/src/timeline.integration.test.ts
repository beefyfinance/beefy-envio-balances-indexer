import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createClickhouseClient } from './client.ts';
import {
    advance,
    cleanup,
    deploy,
    deploymentsTable,
    listDeployments,
    markReady,
    migrate,
    readWatermark,
    readiness,
    reprice,
    rewind,
    switchVersion,
    watermarkMovedAt,
    writeWatermarkIfUnchanged,
} from './deployments.ts';
import { integrationClickhouseUrl } from './lib/config.ts';
import { apiStatus, versionStatuses } from './monitoring.ts';
import { priceStubs } from './pricing.ts';
import { type Schema, type Sql, ident, param, qualified, sql, timeOf } from './sql.ts';
import {
    commitCheckpoint,
    createScratchRaw,
    insertTimelineEvents,
    testRepriceSettings,
    timelineEvent,
} from './testing.ts';
import { apiViews, eventPriceTable, productContractsApi, userTimelineApi } from './timeline.ts';

// Run with: CLICKHOUSE_URL=http://localhost:18123 pnpm test:integration
const url = integrationClickhouseUrl();
const client = createClickhouseClient({ url: url ?? 'http://localhost:0', username: 'default', password: '' });

const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const priceDatabase = `test_px_v${suffix}`;
const envioPrefix = `test_envio_v${suffix}`;
const schema: Schema = {
    database: `test_bi_v${suffix}`,
    prices: { price5m: `${priceDatabase}.asset_price_5m`, token: `${priceDatabase}.token` },
    watermarkPriceSources: ['api', 'beefy_db'],
    envioDatabasePrefix: `${envioPrefix}_`,
};
const raw1 = `${envioPrefix}_1`;
const raw2 = `${envioPrefix}_2`;
const raw3 = `${envioPrefix}_3`;
const settings = testRepriceSettings();
const gate = settings;
const statusSettings = { pendingAlertSeconds: 30 * 60, lookbackDays: settings.retryDays + 2, reprice: settings };

const VAULT = '0xvault';
const ACCOUNT = '0xaccount';
const ASSET = 1;
// a price series only the watermark rule reads, so a test can say how fresh each source is
const FRESHNESS_ASSET = 424242;

const iso = (ms: number): string => timeOf(ms).slice(0, 19);
const ago = (seconds: number): string => iso(Date.now() - seconds * 1000);

let checkpoint = 0;
/**
 * An event; `head` is the indexer's price (fetched at the event time) with the vault's facts, `null` the facts only (an
 * event indexed during a sync), none at all by default.
 */
const event = async (
    raw: string,
    id: string,
    at: string,
    delta = '1000000000000000000',
    head?: number | null
): Promise<number> => {
    checkpoint += 1;
    await insertTimelineEvents(client, raw, [
        timelineEvent({
            id,
            account: ACCOUNT,
            contract: VAULT,
            delta,
            block_number: checkpoint,
            block_timestamp: at,
            envio_checkpoint_id: checkpoint,
            ...(head === undefined
                ? {}
                : {
                      head_price: head,
                      head_price_at: head === null ? null : at,
                      head_product: VAULT,
                      head_decimals: 18,
                      head_product_kind: 'VAULT',
                      head_contract_kind: 'VAULT',
                  }),
        }),
    ]);
    return checkpoint;
};

const price = (at: string, value: number, source = 'api', asset = ASSET): Promise<void> =>
    client.insert(qualified(priceDatabase, 'asset_price_5m'), [
        { asset_id: asset, date_time: at, price: value, price_source: source },
    ]);

/** Both required sources have prices up to `secondsAgo`. */
const sourcesFreshAt = async (secondsAgo: number): Promise<void> => {
    await price(ago(secondsAgo), 1, 'api', FRESHNESS_ASSET);
    await price(ago(secondsAgo), 1, 'beefy_db', FRESHNESS_ASSET);
};

const view = (): Sql => sql`${qualified(schema.database, userTimelineApi())}(account = ${param('String', ACCOUNT)})`;

type Row = { event_id: string; delta: string; share_to_usd: number; price_flag: string };
const timeline = (): Promise<Row[]> =>
    client.query<Row>(
        sql`SELECT event_id, toString(delta) AS delta, share_to_usd, price_flag FROM ${view()} ORDER BY event_id`
    );
const row = async (id: string): Promise<Row | undefined> => (await timeline()).find((r) => r.event_id === id);

type Priced = Row & {
    usd_delta: number;
    price_source: string;
    price_resolution: string;
    before: number | null;
    product_address: string;
    product_kind: string;
    contract_kind: string;
    decimals: number;
};
const priced = async (id: string): Promise<Priced | undefined> => {
    const [r] = await client.query<Priced>(
        sql`SELECT event_id, toString(delta) AS delta, share_to_usd, price_flag, usd_delta, price_source, price_resolution,
            toUnixTimestamp(price_before_at) AS before, product_address, product_kind, contract_kind, decimals
         FROM ${view()} WHERE event_id = ${param('String', id)}`
    );
    return r;
};

const stored = async (id: string): Promise<number | undefined> => {
    const [r] = await client.query<{ price: number }>(
        sql`SELECT share_to_usd AS price FROM ${qualified(schema.database, eventPriceTable(1))} FINAL WHERE event_id = ${param('String', id)}`
    );
    return r?.price;
};

/** The version of an event's latest stored row (0: none): it only grows when the row is written again. */
const storedVersion = async (id: string): Promise<number> => {
    const [r] = await client.query<{ v: string }>(
        sql`SELECT max(version) AS v FROM ${qualified(schema.database, eventPriceTable(1))} WHERE event_id = ${param('String', id)}`
    );
    return Number(r?.v ?? 0);
};

const setPrice = (at: string, value: number): Promise<void> =>
    client.command(
        sql`ALTER TABLE ${qualified(priceDatabase, 'asset_price_5m')} UPDATE price = ${param('Float64', value)}
         WHERE asset_id = ${param('UInt64', ASSET)} AND date_time = ${param("DateTime('UTC')", at)} SETTINGS mutations_sync = 2`
    );

describe.skipIf(url === undefined)('versions: watermark, stored prices, switch and cleanup', () => {
    beforeAll(async () => {
        await client.command(sql`CREATE DATABASE ${ident(priceDatabase)}`);
        for (const statement of priceStubs(schema.prices)) await client.command(statement);
        await client.insert(qualified(priceDatabase, 'token'), [
            { chain_id: 8453, representation_address: VAULT, decimals: 18, asset_id: ASSET },
        ]);
        for (const raw of [raw1, raw2]) {
            await createScratchRaw(client, raw);
            await client.insert(qualified(raw, 'Contract'), [{ chain_id: 8453, address: VAULT, kind: 'VAULT' }]);
            await client.insert(qualified(raw, 'Token'), [{ chain_id: 8453, address: VAULT, decimals: 18 }]);
            // the vault is its own want here: its facts are complete
            await client.insert(qualified(raw, 'ContractLink'), [
                { chain_id: 8453, from_address: VAULT, to_address: VAULT, relation: 'VAULT_WANT', since_block: 1 },
            ]);
        }
        await migrate(client, schema);
        await deploy(client, schema, 1, raw1);
        await switchVersion(client, schema, 1, { ...gate, force: true });
        await price('2024-01-01 10:00:00', 1);
        await price('2024-01-01 10:15:00', 2);
    });
    afterAll(async () => {
        for (const name of [
            raw1,
            raw2,
            raw3,
            `${envioPrefix}_99`,
            `${envioPrefix}_other`,
            schema.database,
            priceDatabase,
        ]) {
            await client.command(sql`DROP DATABASE IF EXISTS ${ident(name)}`);
        }
    });

    it('reports no watermark before the first advance, rather than the epoch', async () => {
        expect(await apiStatus(client, schema, 3000)).toEqual({
            version: 1,
            watermark: null,
            watermarkAgeSeconds: null,
        });
        const [status] = await versionStatuses(client, schema, statusSettings);
        expect(status).toMatchObject({ version: 1, watermark: null, watermarkAgeSeconds: null });
        expect(status?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
    });

    it('refuses to deploy a version on any database but <prefix><N>', async () => {
        await expect(deploy(client, schema, 3, raw1)).rejects.toThrow(`must use the Envio database ${envioPrefix}_3`);
        await expect(deploy(client, schema, 3, `${envioPrefix}_03`)).rejects.toThrow('must use');
        await expect(deploy(client, schema, 3, 'default')).rejects.toThrow('must use');
        await expect(deploy(client, schema, 3, priceDatabase)).rejects.toThrow('must use');
        expect((await listDeployments(client, schema)).map((d) => d.version)).toEqual([1]);
    });

    it('waits for the first committed event before it writes a watermark', async () => {
        const [result] = await advance(client, schema, settings);
        expect(result).toEqual({ version: 1, waiting: 'no-events', statements: 0 });
        expect(await readWatermark(client, schema, 1)).toBeUndefined();
    });

    it('hides rows above the committed checkpoint until Envio commits them, then shows them PENDING until priced', async () => {
        const at = await event(raw1, 'a1', '2024-01-01 10:07:30.000');
        expect(await row('a1')).toBeUndefined();
        await commitCheckpoint(client, raw1, 8453, at);
        // neither a stored row nor an indexer price: nothing is priced when the view is read
        expect(await priced('a1')).toMatchObject({
            share_to_usd: 0,
            price_flag: 'PENDING',
            usd_delta: 0,
            price_source: '',
            price_resolution: '',
            before: null,
            // nor any fact the indexer knew
            product_address: '',
            product_kind: '',
        });
    });

    it('shows the latest history row of an event, and never sees a DELETE row (so handlers never delete one)', async () => {
        await event(raw1, 'z1', '2024-01-01 10:07:30.000', '1');
        const at = await event(raw1, 'z1', '2024-01-01 10:07:30.000', '2');
        await commitCheckpoint(client, raw1, 8453, at);
        expect(await row('z1')).toMatchObject({ delta: '2' });
        // what Envio writes for a deleted entity: the id and the change, every data column empty, so account = ''. The
        // account filter runs before the deduplication and never sees it: the event stays visible. This is why
        // TimelineEvent must never be deleted by a handler (rollbacks are physical deletes, see the next tests).
        checkpoint += 1;
        await client.insert(qualified(raw1, 'envio_history_TimelineEvent'), [
            { id: 'z1', chain_id: 8453, account: '', envio_checkpoint_id: checkpoint, envio_change: 'DELETE' },
        ]);
        await commitCheckpoint(client, raw1, 8453, checkpoint);
        expect(await row('z1')).toMatchObject({ delta: '2' });
    });

    it('does not move the watermark while a required source is behind, and stores provisional rows above it', async () => {
        // only api is fresh: beefy_db has nothing, so the watermark only gets to the oldest event
        await price(ago(3600), 1, 'api', FRESHNESS_ASSET);
        await advance(client, schema, settings);
        const watermark = await readWatermark(client, schema, 1);
        expect(watermark?.watermark).toBe('2024-01-01 00:00:00.000');
        // the events above it have no indexer price: they get a provisional row with the prices known so far
        expect(await stored('a1')).toBe(1.5);
        expect(await row('a1')).toMatchObject({ share_to_usd: 1.5, price_flag: 'OK' });
    });

    it('stores the prices the watermark passes, and the view then returns them', async () => {
        await sourcesFreshAt(3600);
        const [result] = await advance(client, schema, settings);
        expect(result?.statements).toBeGreaterThan(0);
        const watermark = await readWatermark(client, schema, 1);
        // now - 1 day: the sources are fresher than that minus the gap
        expect(Date.now() - Date.parse(`${watermark?.watermark.replace(' ', 'T')}Z`)).toBeGreaterThan(86_000_000);
        expect(Date.now() - Date.parse(`${watermark?.watermark.replace(' ', 'T')}Z`)).toBeLessThan(87_000_000);
        expect(await stored('a1')).toBe(1.5);
        // a price correction below the watermark does not show until the row is repriced: the stored value is used
        await setPrice('2024-01-01 10:15:00', 4);
        expect(await row('a1')).toMatchObject({ share_to_usd: 1.5 });
    });

    it('reprices a range in place without moving the watermark', async () => {
        const before = await readWatermark(client, schema, 1);
        await reprice(client, schema, 1, '2024-01-01', '2024-01-02', settings);
        expect(await stored('a1')).toBe(2.5);
        expect(await row('a1')).toMatchObject({ share_to_usd: 2.5 });
        expect(await readWatermark(client, schema, 1)).toEqual(before);
    });

    it('keeps the stored rows once rewound, and stores them again on the next advance', async () => {
        await setPrice('2024-01-01 10:15:00', 6);
        expect(await row('a1')).toMatchObject({ share_to_usd: 2.5 });
        await rewind(client, schema, 1, '2023-12-01');
        expect(await row('a1')).toMatchObject({ share_to_usd: 2.5 });
        await expect(rewind(client, schema, 1, '2030-01-01')).rejects.toThrow('moves the watermark back');
        await advance(client, schema, settings);
        expect(await stored('a1')).toBe(3.5);
        expect(await row('a1')).toMatchObject({ share_to_usd: 3.5 });
    });

    it('never overwrites a rewind with the watermark of an advance that started before it', async () => {
        const before = await readWatermark(client, schema, 1);
        if (before === undefined) throw new Error('no watermark');
        // an advance remembers the latest row when it starts, then a rewind lands between two of its chunks
        const seen = await watermarkMovedAt(client, schema, 1);
        const chunk = await writeWatermarkIfUnchanged(client, schema, 1, seen, before);
        expect(chunk).toBeDefined();
        await rewind(client, schema, 1, '2023-12-15');
        // its next chunk refuses to write
        expect(await writeWatermarkIfUnchanged(client, schema, 1, chunk ?? '', before)).toBeUndefined();
        expect((await readWatermark(client, schema, 1))?.watermark).toBe('2023-12-15 00:00:00.000');
        // the next advance starts from the rewound watermark and brings it back to a day ago
        const [result] = await advance(client, schema, settings);
        expect(result).toMatchObject({ from: '2023-12-15 00:00:00.000' });
        expect(result?.superseded).toBeUndefined();
        const after = await readWatermark(client, schema, 1);
        expect(Date.now() - Date.parse(`${after?.watermark.replace(' ', 'T')}Z`)).toBeLessThan(87_000_000);
    });

    it('shows the indexer price of a recent event, and stores nothing for it', async () => {
        const at = `${ago(1800)}.000`;
        await commitCheckpoint(client, raw1, 8453, await event(raw1, 'h1', at, '3000000000000000000', 2.5));
        expect(await priced('h1')).toEqual({
            event_id: 'h1',
            delta: '3000000000000000000',
            share_to_usd: 2.5,
            price_flag: 'PROVISIONAL',
            usd_delta: 7.5,
            price_source: 'indexer',
            price_resolution: 'latest',
            before: Math.floor(Date.parse(`${at.replace(' ', 'T')}Z`) / 1000),
            product_address: VAULT,
            product_kind: 'VAULT',
            contract_kind: 'VAULT',
            decimals: 18,
        });
        await advance(client, schema, settings);
        expect(await storedVersion('h1')).toBe(0);
    });

    it('gives a recent event without an indexer price a provisional row, written again only when it changes', async () => {
        await price(ago(3 * 3600), 10);
        // indexed during a sync: no indexer price, but the facts it knew
        await commitCheckpoint(client, raw1, 8453, await event(raw1, 'r1', `${ago(2 * 3600)}.000`, undefined, null));
        expect(await priced('r1')).toMatchObject({
            share_to_usd: 0,
            price_flag: 'PENDING',
            product_address: VAULT,
            product_kind: 'VAULT',
            contract_kind: 'VAULT',
        });
        await advance(client, schema, settings);
        expect(await row('r1')).toMatchObject({ share_to_usd: 10, price_flag: 'EXTRAPOLATED' });
        const first = await storedVersion('r1');
        await advance(client, schema, settings);
        expect(await storedVersion('r1')).toBe(first);
        // a late price snaps it back on the next advance
        await price(ago(3600), 20);
        expect(await row('r1')).toMatchObject({ share_to_usd: 10, price_flag: 'EXTRAPOLATED' });
        await advance(client, schema, settings);
        const r1 = await row('r1');
        expect(r1?.price_flag).toBe('OK');
        expect(r1?.share_to_usd).toBeCloseTo(15, 0);
        expect(await storedVersion('r1')).toBeGreaterThan(first);
    });

    it('replaces a provisional row by the final one when the watermark passes the event', async () => {
        const base = Date.now() - 5 * 86_400_000;
        await rewind(client, schema, 1, iso(base - 86_400_000));
        // a source only this test uses says how far the watermark may go: its freshest price minus the 6 hour gap
        const held = { ...schema, watermarkPriceSources: ['held'] };
        await price(iso(base + 5 * 3_600_000), 1, 'held', FRESHNESS_ASSET);
        await price(iso(base - 600_000), 5);
        await commitCheckpoint(client, raw1, 8453, await event(raw1, 'p1', `${iso(base)}.000`));
        await advance(client, held, settings);
        expect((await readWatermark(client, schema, 1))?.watermark).toBe(`${iso(base - 3_600_000)}.000`);
        expect(await row('p1')).toMatchObject({ share_to_usd: 5, price_flag: 'EXTRAPOLATED' });
        const provisional = await storedVersion('p1');
        // the next price lands, and the watermark passes the event: its final row, with a higher version
        await price(iso(base + 600_000), 7);
        await price(iso(base + 2 * 86_400_000 + 6 * 3_600_000), 1, 'held', FRESHNESS_ASSET);
        await advance(client, held, settings);
        expect((await readWatermark(client, schema, 1))?.watermark).toBe(`${iso(base + 2 * 86_400_000)}.000`);
        expect(await row('p1')).toMatchObject({ share_to_usd: 6, price_flag: 'OK' });
        expect(await storedVersion('p1')).toBeGreaterThan(provisional);
        // back to a day ago for the next tests
        await advance(client, schema, settings);
    });

    it('stores MISSING rows below the watermark, and stores them again within a week once prices arrive', async () => {
        const watermark = await readWatermark(client, schema, 1);
        if (watermark === undefined) throw new Error('no watermark');
        // committed under a checkpoint id the last advance already recorded (a rollback lowered the frontier, the
        // replayed batch reused the id): the late-row step cannot see it, the retry window does
        const recorded = Number(watermark.checkpoints['8453']);
        // two and a half days ago: more than 48 hours from every price of the vault (no price within reach)
        const base = Date.now() - 2.5 * 86_400_000;
        const at = `${iso(base)}.000`;
        await insertTimelineEvents(client, raw1, [
            timelineEvent({
                id: 'reused',
                account: ACCOUNT,
                contract: VAULT,
                delta: '1',
                block_number: recorded,
                block_timestamp: at,
                envio_checkpoint_id: recorded,
            }),
        ]);
        expect(await row('reused')).toMatchObject({ share_to_usd: 0, price_flag: 'PENDING' });
        // no price within reach: stored MISSING, not final
        await advance(client, schema, settings);
        expect(await row('reused')).toMatchObject({ share_to_usd: 0, price_flag: 'MISSING' });
        const missing = await storedVersion('reused');
        expect(missing).toBeGreaterThan(0);
        // retried, but not written again while nothing changed
        await advance(client, schema, settings);
        expect(await storedVersion('reused')).toBe(missing);
        // the prices arrive: the next advance replaces it
        await price(iso(base - 600_000), 7);
        await price(iso(base + 600_000), 9);
        expect(await row('reused')).toMatchObject({ price_flag: 'MISSING' });
        await advance(client, schema, settings);
        expect(await row('reused')).toMatchObject({ share_to_usd: 8, price_flag: 'OK' });
        expect(await stored('reused')).toBe(8);
        // final now: no longer retried
        const final = await storedVersion('reused');
        await advance(client, schema, settings);
        expect(await storedVersion('reused')).toBe(final);
    });

    it('stores an event committed late with a timestamp below the watermark, and its stored row wins over the indexer price', async () => {
        // an old event the indexer priced anyway (a replay at the chain head): its price shows until the advance
        await commitCheckpoint(client, raw1, 8453, await event(raw1, 'late', '2024-01-01 10:07:30.000', undefined, 99));
        expect(await priced('late')).toMatchObject({
            share_to_usd: 99,
            price_flag: 'PROVISIONAL',
            price_source: 'indexer',
        });
        expect(await stored('late')).toBeUndefined();
        await advance(client, schema, settings);
        expect(await stored('late')).toBe(3.5);
        expect(await priced('late')).toMatchObject({ share_to_usd: 3.5, price_flag: 'OK', price_resolution: '5m' });
    });

    it('never shows a stored price whose event Envio deleted (a rollback below the watermark)', async () => {
        expect(await stored('a1')).toBe(3.5);
        await client.command(
            sql`DELETE FROM ${qualified(raw1, 'envio_history_TimelineEvent')} WHERE id = ${param('String', 'a1')} SETTINGS lightweight_deletes_sync = 1`
        );
        expect(await row('a1')).toBeUndefined();
        expect(await stored('a1')).toBe(3.5);
    });

    it('reports the active version and its watermark, and the product contracts', async () => {
        const status = await apiStatus(client, schema, 3000);
        expect(status.version).toBe(1);
        expect(status.watermarkAgeSeconds).toBeGreaterThan(86_000);
        const contracts = await client.query<{ contract: string }>(
            sql`SELECT contract FROM ${qualified(schema.database, productContractsApi())}`
        );
        expect(contracts).toEqual([{ contract: VAULT }]);
        const [version] = await versionStatuses(client, schema, statusSettings);
        expect(version).toMatchObject({ version: 1, state: 'active', envioDatabase: raw1 });
    });

    it('reports the share of the last hour without an indexer price, and PENDING events older than 30 minutes', async () => {
        // h1 (30 minutes ago) has an indexer price; this one has none and no stored row yet
        await commitCheckpoint(client, raw1, 8453, await event(raw1, 'pend', `${ago(40 * 60)}.000`));
        const [before] = await versionStatuses(client, schema, statusSettings);
        expect(before?.headPrices).toEqual({
            lastHourEvents: 2,
            lastHourUnpriced: 1,
            lastHourUnpricedShare: 0.5,
            pendingOld: 1,
        });
        await advance(client, schema, settings);
        const [after] = await versionStatuses(client, schema, statusSettings);
        expect(after?.headPrices?.pendingOld).toBe(0);
    });

    it('switches to a ready version atomically and retires the previous one', async () => {
        await deploy(client, schema, 2, raw2);
        await deploy(client, schema, 2, raw2);
        await commitCheckpoint(client, raw2, 8453, await event(raw2, 'v2', '2024-01-01 10:07:30.000'));
        await expect(switchVersion(client, schema, 2, gate)).rejects.toThrow('not ready');
        expect(await row('v2')).toBeUndefined();
        // an event with no price at all: not ready
        expect(await readiness(client, schema, 2, gate)).toMatchObject({ headColumns: true, pendingEvents: 1 });
        await expect(markReady(client, schema, 2, gate)).rejects.toThrow(
            '1 events older than 15 minutes with no price'
        );
        await advance(client, schema, settings);
        expect(await readiness(client, schema, 2, gate)).toMatchObject({ events: { 8453: 1 }, pendingEvents: 0 });
        await markReady(client, schema, 2, gate);
        // a newer event the indexer did not price and no advance has seen yet: switch refuses until one has
        await commitCheckpoint(client, raw2, 8453, await event(raw2, 'v2late', `${ago(3600)}.000`));
        await expect(switchVersion(client, schema, 2, gate)).rejects.toThrow('PENDING');
        // an event younger than 15 minutes does not count: the next advance is due
        await commitCheckpoint(client, raw2, 8453, await event(raw2, 'v2new', `${ago(60)}.000`, undefined, 3));
        await advance(client, schema, settings);
        expect((await readiness(client, schema, 2, gate)).pendingEvents).toBe(0);
        // the views cannot be built (no such definer): the switch fails after recording where it was going
        await expect(switchVersion(client, { ...schema, definer: `nobody_${suffix}` }, 2, gate)).rejects.toThrow(
            /nobody_/
        );
        expect((await listDeployments(client, schema)).map((d) => [d.version, d.state])).toEqual([
            [1, 'retired'],
            [2, 'active'],
        ]);
        expect((await apiStatus(client, schema, 3000)).version).toBe(1);
        // running it again converges
        await switchVersion(client, schema, 2, gate);
        expect((await timeline()).map((r) => r.event_id)).toEqual(['v2', 'v2late', 'v2new']);
        expect((await apiStatus(client, schema, 3000)).version).toBe(2);
        const states = (await listDeployments(client, schema)).map((d) => [d.version, d.state]);
        expect(states).toEqual([
            [1, 'retired'],
            [2, 'active'],
        ]);
    });

    it('drops only retired versions past the grace period, is rerunnable, and only reports what it does not know', async () => {
        await client.command(sql`CREATE DATABASE ${ident(`${envioPrefix}_99`)}`);
        await client.command(
            sql`CREATE TABLE ${qualified(schema.database, 'event_price_77')} (x UInt8) ENGINE = Memory`
        );
        const kept = await cleanup(client, schema, { graceHours: 1 });
        expect(kept.dropped).toEqual([]);
        // rows no deploy would write: Envio databases that are not <prefix><N> of their version
        await client.command(sql`CREATE DATABASE ${ident(`${envioPrefix}_other`)}`);
        const longAgo = timeOf(Date.now() - 10 * 86_400_000);
        await client.insert(
            qualified(schema.database, deploymentsTable()),
            [
                [5, 'system'],
                [6, 'default'],
                [7, `${envioPrefix}_other`],
            ].map(([version, database]) => ({
                version,
                envio_database: database,
                state: 'retired',
                created_at: timeOf(Date.now()),
                retired_at: longAgo,
                updated_at: timeOf(Date.now()),
            }))
        );
        // a view of ours still names version 1 (a switch back interrupted after its _next view was built): kept
        const [timelineView] = apiViews(schema, { version: 1, envioDatabase: raw1 });
        if (timelineView === undefined) throw new Error('no timeline view');
        await client.command(timelineView.create(`${userTimelineApi()}_next`));
        const used = await cleanup(client, schema, { graceHours: 0 });
        expect(used.dropped).toEqual(['version 5: tables', 'version 6: tables', 'version 7: tables']);
        expect(used.inUse).toEqual([`version 1: ${userTimelineApi()}_next`]);
        await client.command(sql`DROP VIEW ${qualified(schema.database, `${userTimelineApi()}_next`)} SYNC`);
        const report = await cleanup(client, schema, { graceHours: 0 });
        expect(report).toEqual({
            dropped: ['version 1: tables', `version 1: ${raw1}`],
            inUse: [],
            refused: [
                'version 5: system: a database cleanup never drops',
                'version 6: default: a database cleanup never drops',
                `version 7: ${envioPrefix}_other: not ${envioPrefix}_7, the Envio database of version 7`,
            ],
            unknownDatabases: [`${envioPrefix}_99`],
            unknownTables: ['event_price_77'],
        });
        const again = await cleanup(client, schema, { graceHours: 0 });
        expect(again.dropped).toEqual([]);
        expect(again.refused).toHaveLength(3);
        const kept2 = await client.query<{ name: string }>(
            sql`SELECT name FROM system.databases WHERE name IN ${param('Array(String)', ['system', 'default', `${envioPrefix}_other`])}`
        );
        expect(kept2).toHaveLength(3);
        const databases = await client.query<{ name: string }>(
            sql`SELECT name FROM system.databases WHERE startsWith(name, ${param('String', envioPrefix)}) ORDER BY name`
        );
        expect(databases.map(({ name }) => name)).toEqual([raw2, `${envioPrefix}_99`, `${envioPrefix}_other`]);
        const tables = await client.query<{ name: string }>(
            sql`SELECT name FROM system.tables WHERE database = ${param('String', schema.database)} AND endsWith(name, '_1') ORDER BY name`
        );
        expect(tables).toEqual([]);
        expect((await listDeployments(client, schema)).map((d) => d.state)).toEqual([
            'dropped',
            'active',
            'retired',
            'retired',
            'retired',
        ]);
        await expect(switchVersion(client, schema, 1, { ...gate, force: true })).rejects.toThrow('dropped');
        // the active version still answers
        expect((await timeline()).map((r) => r.event_id)).toEqual(['v2', 'v2late', 'v2new']);
    });

    it('neither advances nor switches to a version whose TimelineEvent has no indexer price columns', async () => {
        // a version indexed before the indexer priced events
        await createScratchRaw(client, raw3);
        await client.command(
            sql`ALTER TABLE ${qualified(raw3, 'envio_history_TimelineEvent')}
             DROP COLUMN head_price, DROP COLUMN head_price_at, DROP COLUMN head_product, DROP COLUMN head_decimals,
             DROP COLUMN head_product_kind, DROP COLUMN head_contract_kind`
        );
        await deploy(client, schema, 3, raw3);
        const results = await advance(client, schema, settings);
        expect(results.find((r) => r.version === 3)).toEqual({
            version: 3,
            unsupported: `${raw3}.envio_history_TimelineEvent has no indexer price columns`,
            statements: 0,
        });
        expect(await readiness(client, schema, 3, gate)).toMatchObject({
            headColumns: false,
            pendingEvents: undefined,
        });
        await expect(markReady(client, schema, 3, gate)).rejects.toThrow('has no head_price');
        await markReady(client, schema, 3, { ...gate, force: true });
        await expect(switchVersion(client, schema, 3, gate)).rejects.toThrow('has no head_price');
        expect((await apiStatus(client, schema, 3000)).version).toBe(2);
    });
});
