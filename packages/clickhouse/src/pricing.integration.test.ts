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
    prices: { price5m: `${priceDatabase}.asset_price_5m`, token: `${priceDatabase}.token` },
    watermarkPriceSources: ['api'],
    envioDatabasePrefix: `test_envio_${suffix}_`,
};
const raw = `test_envio_${suffix}_1`;
const settings = testRepriceSettings();

const VAULT = '0xvault';
// a vault whose want has 6 decimals (USDC): its shares are 18-decimal tokens, its price is per 10^6 share units
const USDC_VAULT = '0xusdcvault';
const USDC = '0xusdc';
// a USDC vault whose want link is read after its first event was priced
const LATE_VAULT = '0xlatevault';
const CLM = '0xclm';
// a vault the indexer linked to two wants
const TWO_WANTS = '0xtwowants';
const DAI = '0xdai';
// a vault priced over gaps of a day or two
const SPARSE = '0xsparse';
const ACCOUNT = '0xaccount';

/** Every test token is its own price asset. */
const ASSETS: Record<string, number> = {
    [VAULT]: 1,
    [USDC_VAULT]: 2,
    [LATE_VAULT]: 3,
    [CLM]: 4,
    [USDC]: 5,
    [TWO_WANTS]: 6,
    [SPARSE]: 7,
};

const price = (at: string, value: number, source = 'test', token = VAULT): Promise<void> =>
    client.insert(qualified(priceDatabase, 'asset_price_5m'), [
        { asset_id: ASSETS[token], date_time: at, price: value, price_source: source },
    ]);

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

type Priced = { price: number; flag: string; usd: number; source: string; resolution: string };
/** Reprices one event in place (the reprice job's SQL, now) and reads it back through the API view. */
const priced = async (id: string): Promise<Priced | undefined> => {
    const at = times.get(id) ?? '';
    await reprice(client, schema, 1, at, timeOf(Date.parse(`${at.replace(' ', 'T')}Z`) + 1), settings);
    const [row] = await client.query<Priced>(
        sql`SELECT share_to_usd AS price, price_flag AS flag, usd_delta AS usd, price_source AS source, price_resolution AS resolution
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
            [TWO_WANTS, 'VAULT'],
            [SPARSE, 'VAULT'],
        ]);
        await tokens([
            [CLM, 18],
            [VAULT, 18],
            [USDC_VAULT, 18],
            [USDC, 6],
            [TWO_WANTS, 18],
            [DAI, 18],
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

    it('interpolates between the surrounding prices and values the share change with them', async () => {
        await price('2024-01-01 10:00:00', 1);
        await price('2024-01-01 10:15:00', 2);
        await price('2024-01-01 10:30:00', 3);
        const middle = await event('2024-01-01 10:07:30.000', '2000000000000000000');
        const exact = await event('2024-01-01 10:00:00.000', '-1000000000000000000');
        expect(await priced(middle)).toEqual({ price: 1.5, flag: 'OK', usd: 3, source: 'test', resolution: '5m' });
        expect(await priced(exact)).toEqual({ price: 1, flag: 'OK', usd: -1, source: 'test', resolution: '5m' });
        const [kinds] = await client.query<{ product: string; contract: string }>(
            sql`SELECT product_kind AS product, contract_kind AS contract
             FROM ${qualified(schema.database, userTimelineApi())}(account = ${param('String', ACCOUNT)}) WHERE event_id = ${param('String', middle)}`
        );
        expect(kinds).toEqual({ product: 'VAULT', contract: 'VAULT' });
    });

    it('counts vault shares in the want token decimals, the unit the price is quoted in', async () => {
        await price('2024-05-01 10:00:00', 1.1, 'test', USDC_VAULT);
        await price('2024-05-01 10:15:00', 1.1, 'test', USDC_VAULT);
        // 3 shares as the price counts them: 3 * 10^6 units, not 3 * 10^18
        const id = await event('2024-05-01 10:05:00.000', '3000000', USDC_VAULT);
        expect(await priced(id)).toMatchObject({ price: 1.1, flag: 'OK' });
        expect((await priced(id))?.usd).toBeCloseTo(3.3, 9);
    });

    it('stores a row whose want link is not read yet as incomplete, and the right value once the link lands', async () => {
        await contracts([[LATE_VAULT, 'VAULT']]);
        await tokens([[LATE_VAULT, 18]]);
        await price('2024-06-01 10:00:00', 1, 'test', LATE_VAULT);
        await price('2024-06-01 10:15:00', 1, 'test', LATE_VAULT);
        const id = await event('2024-06-01 10:05:00.000', '3000000', LATE_VAULT);
        // no want link yet (a partial facts read): counted in the share's own 18 decimals, stored as incomplete (the
        // retry window prices it again)
        expect((await priced(id))?.usd).toBeCloseTo(3e-12, 20);
        expect(await factsComplete(id)).toBe(0);
        await wants([[LATE_VAULT, USDC, 1]]);
        expect((await priced(id))?.usd).toBeCloseTo(3, 9);
        expect(await factsComplete(id)).toBe(1);
    });

    it('picks the latest want link when there are several, whatever order they are read in', async () => {
        await price('2024-08-01 10:00:00', 1, 'test', TWO_WANTS);
        await price('2024-08-01 10:15:00', 1, 'test', TWO_WANTS);
        const id = await event('2024-08-01 10:05:00.000', '3000000', TWO_WANTS);
        await wants([
            [TWO_WANTS, USDC, 10],
            [TWO_WANTS, DAI, 20],
        ]);
        // DAI (18 decimals) is the latest: 3 * 10^6 units are 3e-12 shares
        for (let i = 0; i < 3; i += 1) expect((await priced(id))?.usd).toBeCloseTo(3e-12, 20);
        await wants([[TWO_WANTS, USDC, 30]]);
        expect((await priced(id))?.usd).toBeCloseTo(3, 9);
    });

    it('prices a CLM through its share token asset like a vault, and never a vault from its want price', async () => {
        await price('2024-07-01 10:00:00', 400, 'beefy_db', CLM);
        await price('2024-07-01 10:15:00', 500, 'beefy_db', CLM);
        // the USDC vault's want: priced, but the vault's own share asset has no price within reach
        await price('2024-07-01 10:00:00', 999, 'beefy_db', USDC);
        await price('2024-07-01 10:15:00', 999, 'beefy_db', USDC);
        const clm = await event('2024-07-01 10:07:30.000', '2000000000000000000', CLM);
        const vault = await event('2024-07-01 10:07:30.000', '1000000', USDC_VAULT);
        expect(await priced(clm)).toEqual({
            price: expect.closeTo(450, 9),
            flag: 'OK',
            usd: expect.closeTo(900, 9),
            source: 'beefy_db',
            resolution: '5m',
        });
        expect(await priced(vault)).toMatchObject({ price: 0, flag: 'MISSING', resolution: '', source: '' });
    });

    it('extrapolates flat within 48 hours on one side only, and gives up beyond', async () => {
        const before = await event('2024-01-01 08:00:00.000', '1000000000000000000');
        const after = await event('2024-01-01 10:45:00.000', '1000000000000000000');
        // 47 hours before the first price: still within reach
        const early = await event('2023-12-30 11:00:00.000', '1000000000000000000');
        const tooEarly = await event('2023-12-29 09:00:00.000', '1000000000000000000');
        expect(await priced(before)).toMatchObject({ price: 1, flag: 'EXTRAPOLATED', resolution: '5m' });
        expect(await priced(after)).toMatchObject({ price: 3, flag: 'EXTRAPOLATED' });
        expect(await priced(early)).toMatchObject({ price: 1, flag: 'EXTRAPOLATED' });
        expect(await priced(tooEarly)).toMatchObject({ price: 0, flag: 'MISSING', usd: 0, resolution: '' });
    });

    it('interpolates over a gap longer than 6 hours but flags it stale, up to 48 hours on each side', async () => {
        await price('2024-02-01 00:00:00', 10);
        await price('2024-02-01 06:00:00', 16);
        await price('2024-02-01 13:00:00', 23);
        // 6 h then 7 h apart: within reach of the event on both sides, but further apart than the stale threshold
        const id = await event('2024-02-01 09:30:00.000', '1000000000000000000');
        expect(await priced(id)).toMatchObject({ price: 19.5, flag: 'STALE', resolution: '5m' });
        // 30 h before and 20 h after: both within reach
        await price('2024-03-01 00:00:00', 10, 'test', SPARSE);
        await price('2024-03-03 02:00:00', 60, 'test', SPARSE);
        const wide = await event('2024-03-02 06:00:00.000', '1000000000000000000', SPARSE);
        expect(await priced(wide)).toMatchObject({ price: 40, flag: 'STALE' });
        // 50 h before (out of reach) and 10 h after: the later price, carried flat
        await price('2024-03-10 00:00:00', 10, 'test', SPARSE);
        await price('2024-03-12 12:00:00', 60, 'test', SPARSE);
        const oneSide = await event('2024-03-12 02:00:00.000', '1000000000000000000', SPARSE);
        expect(await priced(oneSide)).toMatchObject({ price: 60, flag: 'EXTRAPOLATED' });
    });

    it('takes the larger source when two prices share a time, whatever order they arrive in', async () => {
        await price('2024-04-01 10:00:00', 7, 'beefy_db', SPARSE);
        await price('2024-04-01 10:00:00', 5, 'api', SPARSE);
        const id = await event('2024-04-01 10:00:00.000', '1000000000000000000', SPARSE);
        for (let i = 0; i < 3; i += 1)
            expect(await priced(id)).toMatchObject({ price: 7, source: 'beefy_db', flag: 'OK' });
    });

    it('prices a recent event with one price before it as extrapolated, then interpolates once the next price lands', async () => {
        await price(ago(1800), 5);
        const id = await event(`${ago(600)}.000`, '1000000000000000000');
        expect(await priced(id)).toMatchObject({ price: 5, flag: 'EXTRAPOLATED' });
        await price(ago(300), 6);
        const row = await priced(id);
        expect(row?.flag).toBe('OK');
        expect(row?.price).toBeGreaterThan(5);
        expect(row?.price).toBeLessThan(6);
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
