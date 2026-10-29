import { randomUUID } from 'node:crypto';

import {
    accessStatements,
    advance,
    apiStatus,
    createClickhouseClient,
    deploy,
    eventPriceTable,
    ident,
    migrate,
    param,
    priceStubs,
    qualified,
    type Schema,
    sql,
    switchVersion,
    userTimelineApi,
} from '@beefy/clickhouse';
import {
    commitCheckpoint,
    createScratchRaw,
    insertTimelineEvents,
    testRepriceSettings,
    timelineEvent,
} from '@beefy/clickhouse/testing';
import * as R from 'remeda';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.ts';
import { createRateLimiter } from './http/rateLimit.ts';
import { decodeArrow } from './lib/arrow.ts';
import { integrationClickhouseUrl } from './lib/config.ts';
import { readApiStatus } from './status.ts';
import { buildTimeline, type PricedRow } from './timeline/build.ts';
import { clickhouseTimelineRepository, timelineSelect } from './timeline/repository.ts';
import { createTimelineService } from './timeline/service.ts';

// The whole path: Envio's TimelineEvent rows → user_timeline_api of the active version → repository (ArrowStream) →
// response.
const url = integrationClickhouseUrl();
// the administrator writes what Envio and the analytics tables would hold, and creates the users; the pipeline user
// deploys, switches and advances (it is the views' definer); the API reads as the API user, with the profile `access`
// gives it (readonly, uncompressed Arrow)
const client = createClickhouseClient({ url: url ?? 'http://localhost:0', username: 'default', password: '' });
const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const users = { pipeline: `api_pipe_${suffix}`, api: `api_user_${suffix}` };
const secrets = { pipeline: `pipeline-${randomUUID()}`, api: `api-${randomUUID()}` };
const pipeline = createClickhouseClient({
    url: url ?? 'http://localhost:0',
    username: users.pipeline,
    password: secrets.pipeline,
});
const api = createClickhouseClient({
    url: url ?? 'http://localhost:0',
    username: users.api,
    password: secrets.api,
    readonly: true,
});
const priceDatabase = `api_px_${suffix}`;
const schema: Schema = {
    database: `api_bi_${suffix}`,
    prices: { price5m: `${priceDatabase}.asset_price_5m`, token: `${priceDatabase}.token` },
    watermarkPriceSources: ['api', 'beefy_db'],
    envioDatabasePrefix: `api_envio_${suffix}_`,
    definer: users.pipeline,
};
const raw = `api_envio_${suffix}_1`;
const settings = testRepriceSettings();

const VAULT = '0x00000000000000000000000000000000000000bb';
const BOOST = '0x00000000000000000000000000000000000000cc';
const CLM = '0x00000000000000000000000000000000000000dd';
const ACCOUNT = '0x00000000000000000000000000000000000000aa';
// an account with every kind of row and extreme amounts, to compare the Arrow read with the JSON one
const EVERYTHING = '0x00000000000000000000000000000000000000ee';
const E18 = 10n ** 18n;
const MAX_UINT256 = 2n ** 256n - 1n;
const MIN_INT256 = -(2n ** 255n);

let checkpoint = 0;
/** An event as the indexer writes it during a sync: no price, but its contract's price facts (the boost stakes the vault). */
const event = (
    id: string,
    kind: 'BALANCE' | 'MINT' | 'BURN',
    contract: string,
    delta: bigint,
    after: bigint,
    at: string,
    source = 'TRANSFER',
    trx = id
): Promise<void> =>
    insertTimelineEvents(client, raw, [
        timelineEvent({
            id,
            account: ACCOUNT,
            kind,
            contract,
            source,
            delta: String(delta),
            shares_after: String(after),
            block_number: 100,
            block_timestamp: at,
            trx_hash: `0x${trx}`,
            envio_checkpoint_id: (checkpoint += 1),
            head_product: VAULT,
            head_decimals: 18,
            head_product_kind: 'VAULT',
            head_contract_kind: contract === BOOST ? 'BOOST' : 'VAULT',
        }),
    ]);

const price = (at: string, value: number, source = 'test', asset = 1): Promise<void> =>
    client.insert(qualified(priceDatabase, 'asset_price_5m'), [
        { asset_id: asset, date_time: at, price: value, price_source: source },
    ]);

/**
 * The repository's query as it was read before ArrowStream: the same columns formatted by ClickHouse as JSON. Recent
 * servers (25.10 here) no longer quote 64-bit integers in JSON by default, so `block_number` may come back as a number:
 * it is a string in `PricedRow`, and the response converts it with `Number` either way.
 */
const jsonRows = async (account: string): Promise<PricedRow[]> =>
    (
        await api.query<Omit<PricedRow, 'block_number'> & { block_number: string | number }>(
            sql`SELECT chain_id, toString(toUnixTimestamp64Milli(timestamp)) AS timestamp_ms, block_number, log_index, trx_hash,
            toString(kind) AS kind, contract, source, toString(delta) AS delta, toString(shares_after) AS shares_after,
            toString(amount0) AS amount0, toString(amount1) AS amount1, reward_token, toString(reward_amount) AS reward_amount,
            product_address, product_kind, contract_kind, decimals, share_to_usd, toString(price_flag) AS price_flag,
            price_source, price_resolution, toUnixTimestamp(price_before_at) AS price_before_at,
            toUnixTimestamp(price_after_at) AS price_after_at, usd_delta, usd_after
         FROM ${qualified(schema.database, userTimelineApi())}(account = ${param('String', account)})
         ORDER BY timestamp, chain_id, log_index, event_id`
        )
    ).map((row) => ({ ...row, block_number: String(row.block_number) }));

describe.skipIf(url === undefined)('timeline over ClickHouse', () => {
    beforeAll(async () => {
        for (const statement of accessStatements(schema, {
            pipelineUser: users.pipeline,
            apiUser: users.api,
            pipelinePassword: secrets.pipeline,
            apiPassword: secrets.api,
            envioDatabasePrefix: schema.envioDatabasePrefix,
        })) {
            await client.command(statement);
        }
        await client.command(sql`CREATE DATABASE ${ident(priceDatabase)}`);
        for (const statement of priceStubs(schema.prices)) await client.command(statement);
        await client.insert(qualified(priceDatabase, 'token'), [
            { chain_id: 8453, representation_address: VAULT, decimals: 18, asset_id: 1 },
            { chain_id: 8453, representation_address: CLM, decimals: 18, asset_id: 3 },
        ]);
        await createScratchRaw(client, raw);
        await client.insert(qualified(raw, 'Contract'), [
            { chain_id: 8453, address: VAULT, kind: 'VAULT' },
            { chain_id: 8453, address: CLM, kind: 'CLM_MANAGER' },
        ]);
        await client.insert(qualified(raw, 'Token'), [
            { chain_id: 8453, address: VAULT, decimals: 18 },
            { chain_id: 8453, address: CLM, decimals: 18 },
        ]);
        // the vault is its own want here (complete facts)
        await client.insert(qualified(raw, 'ContractLink'), [
            { chain_id: 8453, from_address: BOOST, to_address: VAULT, relation: 'BOOST_STAKED', since_block: 1 },
            { chain_id: 8453, from_address: VAULT, to_address: VAULT, relation: 'VAULT_WANT', since_block: 1 },
        ]);
        for (const [at, value] of [
            ['2024-01-01 07:00:00', 1],
            ['2024-01-01 14:00:00', 2],
            ['2024-01-02 10:00:00', 2],
            ['2024-01-03 10:00:00', 4],
        ] as const) {
            await price(at, value);
        }
        await price('2024-01-05 00:00:00', 0.1 + 0.2, 'beefy_db', 3);
        await migrate(pipeline, schema);
        await deploy(pipeline, schema, 1, raw);
        await switchVersion(pipeline, schema, 1, { ...settings, force: true });
        // deposit 10, then stake 4 of them in a boost, then withdraw 2
        await event('d1', 'BALANCE', VAULT, 10n * E18, 10n * E18, '2024-01-01 12:00:00.000');
        await event('s1', 'BALANCE', VAULT, -4n * E18, 6n * E18, '2024-01-02 10:00:00.000', 'TRANSFER', 'stake');
        await event('s2', 'BALANCE', BOOST, 4n * E18, 4n * E18, '2024-01-02 10:00:00.000', 'BOOST_STAKE', 'stake');
        await event('w1', 'BALANCE', VAULT, -2n * E18, 4n * E18, '2024-01-03 10:00:00.000');
        // the deposit minted its shares and the withdrawal burned them
        await event('m1', 'MINT', VAULT, 10n * E18, 0n, '2024-01-01 12:00:00.000', 'TRANSFER', 'd1');
        await event('b1', 'BURN', VAULT, -2n * E18, 0n, '2024-01-03 10:00:00.000', 'TRANSFER', 'w1');
        // every kind of row, extreme amounts, priced by the indexer or not, one of them stored below
        // the largest block number JSON.parse reads exactly (Arrow reads any UInt64 exactly: see lib/arrow.test.ts)
        const base = { account: EVERYTHING, block_number: '9007199254740991', log_index: 0 };
        await insertTimelineEvents(client, raw, [
            timelineEvent({
                ...base,
                id: 'x1',
                kind: 'BALANCE',
                contract: VAULT,
                delta: String(MIN_INT256),
                shares_after: String(MAX_UINT256),
                block_timestamp: '2024-01-01 12:00:00.123',
                envio_checkpoint_id: (checkpoint += 1),
            }),
            timelineEvent({
                ...base,
                id: 'x2',
                kind: 'CLM_DEPOSIT',
                contract: CLM,
                amount0: String(MAX_UINT256),
                amount1: '1',
                block_timestamp: '2024-01-05 00:00:00.000',
                log_index: 7,
                envio_checkpoint_id: (checkpoint += 1),
            }),
            timelineEvent({
                ...base,
                id: 'x3',
                kind: 'CLAIM',
                contract: CLM,
                reward_token: '0x00000000000000000000000000000000000000ff',
                reward_amount: String(MAX_UINT256 - 1n),
                block_timestamp: '2024-01-05 00:00:00.000',
                log_index: 8,
                envio_checkpoint_id: (checkpoint += 1),
            }),
            timelineEvent({
                ...base,
                id: 'x4',
                kind: 'BALANCE',
                contract: CLM,
                delta: '123456789',
                shares_after: '123456789',
                block_timestamp: '2030-01-01 00:00:00.999',
                head_price: 1 / 3,
                head_price_at: '2030-01-01 00:00:00.000',
                head_product: CLM,
                head_decimals: 6,
                head_product_kind: 'CLM_MANAGER',
                head_contract_kind: 'CLM_MANAGER',
                envio_checkpoint_id: (checkpoint += 1),
            }),
            timelineEvent({
                ...base,
                id: 'x5',
                kind: 'BURN',
                contract: VAULT,
                delta: '-1',
                block_timestamp: '2030-01-02 00:00:00.000',
                source: 'it\'s "odd" é😀',
                trx_hash: '0x\n',
                envio_checkpoint_id: (checkpoint += 1),
            }),
        ]);
        await commitCheckpoint(client, raw, 8453, checkpoint);
    });
    afterAll(async () => {
        for (const name of [raw, schema.database, priceDatabase])
            await client.command(sql`DROP DATABASE IF EXISTS ${ident(name)} SYNC`);
        for (const user of R.values(users)) {
            await client.command(sql`DROP USER IF EXISTS ${ident(user)}`);
            await client.command(sql`DROP SETTINGS PROFILE IF EXISTS ${ident(`${user}_profile`)}`);
        }
        await client.command(sql`DROP QUOTA IF EXISTS ${ident(`${users.api}_quota`)}`);
    });

    const appFor = () => {
        const service = createTimelineService({
            repository: clickhouseTimelineRepository(api, schema.database, 5000, 20_000),
            cacheBytes: 10_000_000,
            missesPerMinute: 600,
            missBurst: 100,
            clientMissesPerMinute: 600,
            clientMissBurst: 100,
            maxInFlight: 4,
            maxQueue: 4,
            maxQueueWaitMs: 100,
        });
        return createApp({
            timeline: {
                service,
                blocked: () => new Set(),
                clientLimiter: createRateLimiter({ ratePerMinute: 6000, burst: 100 }),
                clientIp: { source: 'socket', cloudflare: [] },
            },
        });
    };

    type Body = {
        count: number;
        items: {
            datetime: string;
            actions: string[];
            share_balance: string;
            share_diff: string;
            usd_balance: number;
            usd_diff: number;
            price: { share_to_usd: number; flag: string; source?: string; resolution: string | null };
        }[];
    };

    const expectHistory = (body: Body): void => {
        expect(body.count).toBe(3);
        const [withdraw, stake, deposit] = body.items;
        expect(deposit).toMatchObject({
            actions: ['deposit'],
            share_balance: '10',
            share_diff: '10',
            price: { flag: 'STALE', resolution: '5m' },
        });
        // the bracketing prices are 7 hours apart (more than the trusted gap), so the value is interpolated but flagged
        // stale: 12:00 is five hours into the seven between prices 1 and 2
        expect(deposit?.price.share_to_usd).toBeCloseTo(1 + 5 / 7, 6);
        expect(stake).toMatchObject({
            actions: ['stake'],
            share_balance: '10',
            share_diff: '0',
            price: { share_to_usd: 2, flag: 'OK', resolution: '5m' },
        });
        expect(withdraw).toMatchObject({
            actions: ['withdraw'],
            share_balance: '8',
            share_diff: '-2',
            usd_balance: 32,
            usd_diff: -8,
        });
    };

    /** One total order, so rows that tie on (time, chain, log) compare the same whichever way they were read. */
    const ordered = (rows: readonly PricedRow[]): PricedRow[] =>
        [...rows].sort(
            (a, b) =>
                Number(a.timestamp_ms) - Number(b.timestamp_ms) ||
                a.chain_id - b.chain_id ||
                a.log_index - b.log_index ||
                JSON.stringify(a).localeCompare(JSON.stringify(b))
        );

    /** The Arrow rows and the JSON rows of an account are the same values, and build the same response bytes. */
    const compare = async (account: string): Promise<void> => {
        const arrow = ordered(await clickhouseTimelineRepository(api, schema.database, 5000, 20_000).rows(account));
        const json = ordered(await jsonRows(account));
        expect(arrow.length).toBeGreaterThan(0);
        expect(arrow).toEqual(json);
        expect(JSON.stringify(buildTimeline(arrow))).toBe(JSON.stringify(buildTimeline(json)));
    };

    it('serves the events PENDING, with no USD value, before any advance priced them', async () => {
        const response = await appFor().request(`/v1/users/${ACCOUNT}/timeline`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as Body;
        // the facts the indexer wrote on the events group the boost under its vault already
        expect(body.count).toBe(3);
        for (const item of body.items) {
            expect(item).toMatchObject({ usd_diff: 0, price: { share_to_usd: 0, flag: 'PENDING', resolution: null } });
        }
        const stake = body.items[1] as unknown as {
            actions: string[];
            share_balance: string;
            contracts: { kind: string }[];
        };
        expect(stake).toMatchObject({ actions: ['stake'], share_balance: '10' });
        expect(stake.contracts.map(({ kind }) => kind).sort()).toEqual(['BOOST', 'VAULT']);
        await compare(ACCOUNT);
        await compare(EVERYTHING);
    });

    it('serves the history newest first with interpolated prices and the product balance across vault and boost, once stored', async () => {
        // both required sources are fresh: the watermark moves to a day ago, past every event
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        await price(now, 1, 'api', 2);
        await price(now, 1, 'beefy_db', 2);
        const [result] = await advance(pipeline, schema, settings);
        expect(result?.version).toBe(1);
        const status = await readApiStatus(api, schema.database, 3000);
        expect(status).toEqual(await apiStatus(api, schema, 3000));
        expect(status.version).toBe(1);
        expect(status.watermarkAgeSeconds).toBeGreaterThanOrEqual(86_400);
        expect(status.watermarkAgeSeconds).toBeLessThan(2 * 86_400);
        const [stored] = await client.query<{ rows: string }>(
            sql`SELECT count() AS rows FROM ${qualified(schema.database, eventPriceTable(1))} FINAL`
        );
        // the 6 rows of the account; the other one's 3 older than the watermark, and a provisional row for its future
        // event the indexer did not price
        expect(Number(stored?.rows)).toBe(10);
        const response = await appFor().request(`/v1/users/${ACCOUNT}/timeline`);
        expectHistory((await response.json()) as Body);
        // stored rows (with price times), indexer prices and pending rows read the same in Arrow as in JSON
        await compare(ACCOUNT);
        await compare(EVERYTHING);
    });

    it('serves a recent event with the indexer price until a stored row replaces it', async () => {
        const at = new Date(Date.now() - 600_000).toISOString().replace('T', ' ').slice(0, 23);
        await insertTimelineEvents(client, raw, [
            timelineEvent({
                id: 'n1',
                account: ACCOUNT,
                contract: VAULT,
                delta: String(E18),
                shares_after: String(9n * E18),
                block_number: 100,
                block_timestamp: at,
                envio_checkpoint_id: (checkpoint += 1),
                head_price: 3,
                head_price_at: at,
                head_product: VAULT,
                head_decimals: 18,
                head_product_kind: 'VAULT',
                head_contract_kind: 'VAULT',
            }),
        ]);
        await commitCheckpoint(client, raw, 8453, checkpoint);
        const response = await appFor().request(`/v1/users/${ACCOUNT}/timeline`);
        const [latest] = ((await response.json()) as Body).items;
        expect(latest).toMatchObject({
            actions: ['transfer_in'],
            share_balance: '9',
            usd_balance: 27,
            usd_diff: 3,
            price: { share_to_usd: 3, flag: 'PROVISIONAL', source: 'indexer', resolution: 'latest' },
        });
    });

    it('returns an empty timeline for an account with no events', async () => {
        const response = await appFor().request(`/v1/users/0x${'1'.repeat(40)}/timeline`);
        expect(await response.json()).toMatchObject({ count: 0, items: [] });
    });

    it('refuses an account over the row limit, counted by ClickHouse with a LIMIT parameter', async () => {
        const repository = clickhouseTimelineRepository(api, schema.database, 5000, 2);
        await expect(repository.rows(ACCOUNT)).rejects.toThrow('more than 2 rows');
        const rows = await decodeArrow(await api.stream(timelineSelect(schema.database, ACCOUNT, 3)), {
            trx_hash: { kind: 'string' },
        });
        expect(rows).toHaveLength(3);
    });

    it('knows the product contracts, so they are not served as users', async () => {
        const contracts = await clickhouseTimelineRepository(api, schema.database, 5000, 20_000).productContracts();
        expect(contracts.sort()).toEqual([VAULT, BOOST, CLM].sort());
    });
});
