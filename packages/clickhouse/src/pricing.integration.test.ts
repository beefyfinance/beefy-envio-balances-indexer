import { randomUUID } from 'node:crypto';

import * as R from 'remeda';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createClickhouseClient } from './client.ts';
import { deploy, migrate, reprice, switchVersion } from './deployments.ts';
import { integrationClickhouseUrl } from './lib/config.ts';
import { priceStubs } from './pricing.ts';
import { type Schema, ident, param, qualified, qualifiedName, sql, timeOf } from './sql.ts';
import {
    commitCheckpoint,
    createScratchRaw,
    insertTimelineEvents,
    slotOf,
    testRepriceSettings,
    timelineEvent,
} from './testing.ts';
import { eventPriceTable, userTimelineApi } from './timeline.ts';

// Run with: CLICKHOUSE_URL=http://localhost:18123 pnpm test:integration
const url = integrationClickhouseUrl();
const client = createClickhouseClient({ url: url ?? 'http://localhost:0', username: 'default', password: '' });

const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const priceDatabase = `test_px_${suffix}`;
const schema: Schema = {
    database: `test_bi_${suffix}`,
    prices: { price5m: `${priceDatabase}.fact_asset_price_5m`, token: `${priceDatabase}.dim_token` },
    watermarkPriceSources: ['api'],
    envioDatabasePrefix: `test_envio_${suffix}_`,
};
const raw = `test_envio_${suffix}_1`;
const settings = testRepriceSettings();

const VAULT = '0xvault';
// a vault whose want has 6 decimals (USDC): its shares are 18-decimal tokens, its price is per 10^18 share units
const USDC_VAULT = '0xusdcvault';
const USDC = '0xusdc';
// a vault whose share decimals are read after its first event was priced
const LATE_VAULT = '0xlatevault';
const CLM = '0xclm';
// a vault whose price slots are carried from older prices
const SPARSE = '0xsparse';
const ACCOUNT = '0xaccount';

/** Every test token is its own price asset. */
const ASSETS: Record<string, number> = {
    [VAULT]: 1,
    [USDC_VAULT]: 2,
    [LATE_VAULT]: 3,
    [CLM]: 4,
    [USDC]: 5,
    [SPARSE]: 7,
};

/** The price row of one 5 minute slot: an actual price, or one carried forward from the slot `carriedFrom`. */
const price = (at: string, value: number, source = 'test', token = VAULT, carriedFrom?: string): Promise<void> =>
    client.insert(qualified(priceDatabase, 'fact_asset_price_5m'), [
        {
            asset_id: ASSETS[token],
            date_time: at,
            price: value,
            price_source: source,
            is_carried: carriedFrom === undefined ? 0 : 1,
            observed_at: carriedFrom ?? at,
        },
    ]);

const unix = (at: string): number => Date.parse(`${at.replace(' ', 'T')}Z`) / 1000;

/** When each event happened, so {@link priced} can reprice just that one. */
const times = new Map<string, string>();
let eventNumber = 0;

const event = async (at: string, delta: string, vault = VAULT): Promise<string> => {
    eventNumber += 1;
    const id = `e${eventNumber}`;
    times.set(id, at);
    await insertTimelineEvents(client, raw, [
        timelineEvent({
            id,
            account: ACCOUNT,
            contract: vault,
            delta,
            block_number: 100 + eventNumber,
            block_timestamp: at,
            envio_checkpoint_id: eventNumber,
        }),
    ]);
    return id;
};

const ago = (seconds: number): string => timeOf(Date.now() - seconds * 1000).slice(0, 19);

type Priced = { price: number; flag: string; usd: number; source: string; resolution: string; before: number | null };
/** Reprices one event in place (the reprice job's SQL, now) and reads it back through the API view. */
const priced = async (id: string): Promise<Priced | undefined> => {
    const at = times.get(id) ?? '';
    await reprice(client, schema, 1, at, timeOf(Date.parse(`${at.replace(' ', 'T')}Z`) + 1), settings);
    const [row] = await client.query<Priced>(
        sql`SELECT share_to_usd AS price, price_flag AS flag, usd_delta AS usd, price_source AS source, price_resolution AS resolution,
            toUnixTimestamp(price_before_at) AS before
         FROM ${qualified(schema.database, userTimelineApi())}(account = ${param('String', ACCOUNT)}) WHERE event_id = ${param('String', id)}`
    );
    return row;
};

/** Whether the stored row of an event rests on complete product facts (undefined: no stored row). */
const factsComplete = async (id: string): Promise<number | undefined> => {
    const [row] = await client.query<{ complete: number }>(
        sql`SELECT facts_complete AS complete FROM ${qualified(schema.database, eventPriceTable(1))} FINAL WHERE event_id = ${param('String', id)}`
    );
    return row?.complete;
};

const contracts = (rows: [string, string][]): Promise<void> =>
    client.insert(
        qualified(raw, 'Contract'),
        rows.map(([address, kind]) => ({ chain_id: 8453, address, kind }))
    );
const tokens = (rows: [string, number][]): Promise<void> =>
    client.insert(
        qualified(raw, 'Token'),
        rows.map(([address, decimals]) => ({ chain_id: 8453, address, decimals }))
    );
const wants = (rows: [string, string, number][]): Promise<void> =>
    client.insert(
        qualified(raw, 'ContractLink'),
        rows.map(([from, to, since]) => ({
            chain_id: 8453,
            from_address: from,
            to_address: to,
            relation: 'VAULT_WANT',
            since_block: since,
        }))
    );

describe.skipIf(url === undefined)('pricing, stored by the reprice job and read through the API view', () => {
    beforeAll(async () => {
        await client.command(sql`CREATE DATABASE ${ident(priceDatabase)}`);
        for (const statement of priceStubs(schema.prices)) await client.command(statement);
        await client.insert(
            qualifiedName(schema.prices.token),
            R.pipe(
                ASSETS,
                R.entries(),
                R.map(([token, asset]) => ({
                    chain_id: 8453,
                    representation_address: token,
                    decimals: 18,
                    asset_id: asset,
                }))
            )
        );
        await createScratchRaw(client, raw);
        await commitCheckpoint(client, raw, 8453, 1_000_000);
        await contracts([
            [CLM, 'CLM_MANAGER'],
            [VAULT, 'VAULT'],
            [USDC_VAULT, 'VAULT'],
            [SPARSE, 'VAULT'],
        ]);
        await tokens([
            [CLM, 18],
            [VAULT, 18],
            [USDC_VAULT, 18],
            [USDC, 6],
            [SPARSE, 18],
        ]);
        await wants([
            [USDC_VAULT, USDC, 1],
            [VAULT, VAULT, 1],
            [SPARSE, SPARSE, 1],
        ]);
        await migrate(client, schema);
        await deploy(client, schema, 1, raw);
        await switchVersion(client, schema, 1, { ...testRepriceSettings(), force: true });
    });
    afterAll(async () => {
        for (const name of [raw, schema.database, priceDatabase])
            await client.command(sql`DROP DATABASE IF EXISTS ${ident(name)}`);
    });

    it('prices an event with the row of its 5 minute slot, never interpolated', async () => {
        await price('2024-01-01 10:00:00', 1);
        await price('2024-01-01 10:05:00', 1.5);
        await price('2024-01-01 10:10:00', 2);
        const middle = await event('2024-01-01 10:07:30.000', '2000000000000000000');
        const exact = await event('2024-01-01 10:00:00.000', '-1000000000000000000');
        expect(await priced(middle)).toEqual({
            price: 1.5,
            flag: 'OK',
            usd: 3,
            source: 'test',
            resolution: '5m',
            before: unix('2024-01-01 10:05:00'),
        });
        expect(await priced(exact)).toEqual({
            price: 1,
            flag: 'OK',
            usd: -1,
            source: 'test',
            resolution: '5m',
            before: unix('2024-01-01 10:00:00'),
        });
        const [kinds] = await client.query<{ product: string; contract: string }>(
            sql`SELECT product_kind AS product, contract_kind AS contract
             FROM ${qualified(schema.database, userTimelineApi())}(account = ${param('String', ACCOUNT)}) WHERE event_id = ${param('String', middle)}`
        );
        expect(kinds).toEqual({ product: 'VAULT', contract: 'VAULT' });
    });

    it("counts vault shares in the share token decimals, the unit the price is quoted in, never the want's", async () => {
        await price('2024-05-01 10:05:00', 1.1, 'test', USDC_VAULT);
        // 3 shares: 3 * 10^18 units, although the want (USDC) has 6 decimals
        const id = await event('2024-05-01 10:05:00.000', '3000000000000000000', USDC_VAULT);
        expect(await priced(id)).toMatchObject({ price: 1.1, flag: 'OK' });
        expect((await priced(id))?.usd).toBeCloseTo(3.3, 9);
    });

    it('stores a row whose share decimals are not read yet as incomplete, and complete once they land', async () => {
        await contracts([[LATE_VAULT, 'VAULT']]);
        await price('2024-06-01 10:05:00', 1, 'test', LATE_VAULT);
        const id = await event('2024-06-01 10:05:00.000', '3000000000000000000', LATE_VAULT);
        // no share decimals yet (a partial facts read): counted in 18 decimals, stored as incomplete (the retry window
        // prices it again)
        expect((await priced(id))?.usd).toBeCloseTo(3, 9);
        expect(await factsComplete(id)).toBe(0);
        await tokens([[LATE_VAULT, 18]]);
        expect((await priced(id))?.usd).toBeCloseTo(3, 9);
        expect(await factsComplete(id)).toBe(1);
    });

    it('prices a CLM through its share token asset like a vault, and never a vault from its want price', async () => {
        await price('2024-07-01 10:05:00', 450, 'beefy_db', CLM);
        // the USDC vault's want: priced, but the vault's own share asset has no row for the slot
        await price('2024-07-01 10:05:00', 999, 'beefy_db', USDC);
        const clm = await event('2024-07-01 10:07:30.000', '2000000000000000000', CLM);
        const vault = await event('2024-07-01 10:07:30.000', '1000000', USDC_VAULT);
        expect(await priced(clm)).toEqual({
            price: 450,
            flag: 'OK',
            usd: 900,
            source: 'beefy_db',
            resolution: '5m',
            before: unix('2024-07-01 10:05:00'),
        });
        expect(await priced(vault)).toMatchObject({
            price: 0,
            flag: 'MISSING',
            resolution: '',
            source: '',
            before: null,
        });
    });

    it('flags a carried slot OK within 6 hours of the slot it carries, STALE beyond, MISSING with no slot', async () => {
        const from = '2024-02-01 00:00:00';
        await price(from, 10, 'test', SPARSE);
        await price('2024-02-01 06:00:00', 10, 'test', SPARSE, from);
        // a vault's carried slot: its last share rate times the want price of the slot, so not always the last value
        await price('2024-02-01 06:05:00', 11, 'test', SPARSE, from);
        await price('2024-02-02 12:00:00', 12, 'test', SPARSE, from);
        // the age is the row's own: the actual price it carries need not be in the table
        await price('2024-02-05 12:00:00', 13, 'test', SPARSE, '2024-02-05 08:00:00');
        const carried = await event('2024-02-01 06:02:00.000', '1000000000000000000', SPARSE);
        const stale = await event('2024-02-01 06:05:00.000', '1000000000000000000', SPARSE);
        const old = await event('2024-02-02 12:01:00.000', '1000000000000000000', SPARSE);
        const alone = await event('2024-02-05 12:03:00.000', '1000000000000000000', SPARSE);
        const none = await event('2024-02-03 00:00:00.000', '1000000000000000000', SPARSE);
        expect(await priced(carried)).toMatchObject({ price: 10, flag: 'OK', before: unix(from) });
        expect(await priced(stale)).toMatchObject({ price: 11, flag: 'STALE', before: unix(from) });
        expect(await priced(old)).toMatchObject({ price: 12, flag: 'STALE', resolution: '5m', before: unix(from) });
        expect(await priced(alone)).toMatchObject({ price: 13, flag: 'OK', before: unix('2024-02-05 08:00:00') });
        expect(await priced(none)).toMatchObject({ price: 0, flag: 'MISSING', usd: 0, resolution: '', before: null });
    });

    it('takes the actual price, then the larger source, when two rows share a slot, whatever order they arrive in', async () => {
        await price('2024-04-01 10:00:00', 9, 'zzz', SPARSE, '2024-04-01 09:00:00');
        await price('2024-04-01 10:00:00', 7, 'beefy_db', SPARSE);
        await price('2024-04-01 10:00:00', 5, 'api', SPARSE);
        const id = await event('2024-04-01 10:00:00.000', '1000000000000000000', SPARSE);
        for (let i = 0; i < 3; i += 1)
            expect(await priced(id)).toMatchObject({ price: 7, source: 'beefy_db', flag: 'OK' });
    });

    it('prices a recent event MISSING until the row of its slot lands', async () => {
        const at = ago(600);
        const id = await event(`${at}.000`, '1000000000000000000');
        expect(await priced(id)).toMatchObject({ price: 0, flag: 'MISSING' });
        await price(slotOf(at), 6);
        expect(await priced(id)).toMatchObject({ price: 6, flag: 'OK' });
    });

    it("prices an ERC-4626 adapter's shares as the vault it wraps", async () => {
        const adapter = '0xadapter';
        await contracts([[adapter, 'ERC4626_ADAPTER']]);
        await tokens([[adapter, 18]]);
        await client.insert(qualified(raw, 'ContractLink'), [
            { chain_id: 8453, from_address: adapter, to_address: VAULT, relation: 'ADAPTER_VAULT', since_block: 1 },
        ]);
        await price('2024-08-01 10:00:00', 2);
        const id = await event('2024-08-01 10:01:00.000', '3000000000000000000', adapter);
        expect(await priced(id)).toMatchObject({ price: 2, flag: 'OK', usd: 6 });
        expect(await factsComplete(id)).toBe(1);
        const [row] = await client.query<{ product: string; product_kind: string; contract_kind: string }>(
            sql`SELECT product_address AS product, product_kind, contract_kind
             FROM ${qualified(schema.database, userTimelineApi())}(account = ${param('String', ACCOUNT)}) WHERE event_id = ${param('String', id)}`
        );
        expect(row).toEqual({ product: VAULT, product_kind: 'VAULT', contract_kind: 'ERC4626_ADAPTER' });
    });

    it('marks an event of an unknown contract missing instead of dropping it, stored with incomplete facts', async () => {
        const id = await event('2024-01-01 10:00:00.000', '1', '0xunknown');
        expect(await priced(id)).toMatchObject({ price: 0, flag: 'MISSING' });
        expect(await factsComplete(id)).toBe(0);
    });

    it('returns every event of the account once, with the columns the API reads', async () => {
        const view = sql`${qualified(schema.database, userTimelineApi())}(account = ${param('String', ACCOUNT)})`;
        const rows = await client.query<{ n: string; ids: string }>(
            sql`SELECT count() AS n, uniqExact(event_id) AS ids FROM ${view}`
        );
        expect(Number(rows[0]?.n)).toBe(eventNumber);
        expect(Number(rows[0]?.ids)).toBe(eventNumber);
        const [row] = await client.query<Record<string, unknown>>(sql`SELECT * FROM ${view} LIMIT 1`);
        expect(R.keys(row ?? {})).toEqual([
            'account',
            'chain_id',
            'timestamp',
            'block_number',
            'log_index',
            'trx_hash',
            'kind',
            'contract',
            'source',
            'delta',
            'shares_after',
            'amount0',
            'amount1',
            'reward_token',
            'reward_amount',
            'event_id',
            'product_address',
            'product_kind',
            'contract_kind',
            'decimals',
            'share_to_usd',
            'price_flag',
            'price_source',
            'price_resolution',
            'price_before_at',
            'price_after_at',
            'usd_delta',
            'usd_after',
        ]);
    });
});
