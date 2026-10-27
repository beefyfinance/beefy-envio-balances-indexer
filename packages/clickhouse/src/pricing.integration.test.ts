import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createClickhouseClient } from './client.ts';
import { attach, migrate } from './migrate.ts';
import { productSharePriceStub, stampRangeStatement } from './pricing.ts';
import { qualified } from './sql.ts';
import { createScratchRaw } from './testing.ts';

// Run with: CLICKHOUSE_URL=http://localhost:18123 pnpm test:integration
const url = process.env['CLICKHOUSE_URL'];
const client = createClickhouseClient({ url: url ?? 'http://localhost:0', username: 'default', password: '' });

const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const db = { raw: `test_raw_${suffix}`, analytics: `test_an_${suffix}`, prices: `test_px_${suffix}` };

const VAULT = '0xvault';
const ACCOUNT = '0xaccount';
let eventNumber = 0;

const price = (at: string, value: number, source = 'test'): Promise<void> =>
    client.command(
        `INSERT INTO ${qualified(db.prices, 'int_product_share_price')} VALUES (8453, '${VAULT}', 'beefy:vault:base:${VAULT}', '${at}', ${value}, '${source}', 1)`
    );

const event = async (
    at: string,
    delta: string,
    change: 'SET' | 'DELETE' = 'SET',
    id = `e${eventNumber + 1}`
): Promise<string> => {
    eventNumber += 1;
    await client.command(
        `INSERT INTO ${db.raw}.envio_history_BalanceChange VALUES
         ('${id}', '${VAULT}', '${ACCOUNT}', '${delta}', '0', 'TRANSFER', 100, '${at}', '0x${id}', NULL, 1, 8453, ${eventNumber}, '${change}')`
    );
    return id;
};

type Stamped = { price: number; flag: string; usd: number; source: string };
const stamped = async (id: string): Promise<Stamped | undefined> => {
    const [row] = await client.query<{ price: number; flag: string; usd: number; source: string }>(
        `SELECT share_to_usd AS price, toString(price_flag) AS flag, usd_delta AS usd, price_source AS source
         FROM ${qualified(db.analytics, 'user_timeline_priced')} FINAL WHERE event_id = '${id}' AND is_deleted = 0`
    );
    return row;
};

const stampAll = async (): Promise<void> => {
    await client.command(`SYSTEM REFRESH VIEW ${qualified(db.analytics, 'mv_stamp_recent')}`);
    await client.command(`SYSTEM WAIT VIEW ${qualified(db.analytics, 'mv_stamp_recent')}`);
};

const pricedRowCount = async (): Promise<number> => {
    const [row] = await client.query<{ n: string }>(
        `SELECT count() AS n FROM ${qualified(db.analytics, 'user_timeline_priced')}`
    );
    return Number(row?.n);
};

describe.skipIf(url === undefined)('stamping', () => {
    beforeAll(async () => {
        await client.command(`CREATE DATABASE ${db.prices}`);
        await client.command(productSharePriceStub(db));
        await createScratchRaw(client, db.raw);
        await client.command(`INSERT INTO ${db.raw}.Contract VALUES (8453, '${VAULT}', 'VAULT')`);
        await client.command(`INSERT INTO ${db.raw}.Token VALUES (8453, '${VAULT}', 18)`);
        await migrate(client, db);
        await attach(client, db);
    });
    afterAll(async () => {
        for (const name of [db.raw, db.analytics, db.prices]) {
            await client.command(`DROP DATABASE IF EXISTS ${name}`);
        }
    });

    it('interpolates between the surrounding prices and values the share change with them', async () => {
        await price('2024-01-01 10:00:00', 1);
        await price('2024-01-01 10:15:00', 2);
        await price('2024-01-01 10:30:00', 3);
        const middle = await event('2024-01-01 10:07:30.000', '2000000000000000000');
        const exact = await event('2024-01-01 10:00:00.000', '-1000000000000000000');
        await stampAll();
        expect(await stamped(middle)).toEqual({ price: 1.5, flag: 'OK', usd: 3, source: 'test' });
        expect(await stamped(exact)).toEqual({ price: 1, flag: 'OK', usd: -1, source: 'test' });
        const [kinds] = await client.query<{ product: string; contract: string }>(
            `SELECT product_kind AS product, contract_kind AS contract
             FROM ${qualified(db.analytics, 'user_timeline_priced')} FINAL WHERE event_id = '${middle}'`
        );
        expect(kinds).toEqual({ product: 'VAULT', contract: 'VAULT' });
    });

    it('extrapolates flat within the gap on one side only, and gives up beyond it', async () => {
        const before = await event('2024-01-01 08:00:00.000', '1000000000000000000');
        const after = await event('2024-01-01 10:45:00.000', '1000000000000000000');
        const tooEarly = await event('2023-12-31 20:00:00.000', '1000000000000000000');
        await stampAll();
        expect(await stamped(before)).toMatchObject({ price: 1, flag: 'EXTRAPOLATED' });
        expect(await stamped(after)).toMatchObject({ price: 3, flag: 'EXTRAPOLATED' });
        expect(await stamped(tooEarly)).toMatchObject({ price: 0, flag: 'MISSING', usd: 0 });
    });

    it('interpolates over a long gap but flags it stale', async () => {
        await price('2024-02-01 00:00:00', 10);
        await price('2024-02-01 12:00:00', 20);
        const id = await event('2024-02-01 06:00:00.000', '1000000000000000000');
        await stampAll();
        expect(await stamped(id)).toMatchObject({ price: 15, flag: 'STALE' });
    });

    it('prices a recent event provisionally, then interpolates once the next price lands', async () => {
        const now = Math.floor(Date.now() / 1000);
        const at = (secondsAgo: number): string =>
            new Date((now - secondsAgo) * 1000).toISOString().replace('T', ' ').slice(0, 19);
        await price(at(1800), 5);
        const id = await event(`${at(600)}.000`, '1000000000000000000');
        await stampAll();
        expect(await stamped(id)).toMatchObject({ price: 5, flag: 'PROVISIONAL' });
        await price(at(300), 6);
        await stampAll();
        // 600 s ago is two thirds of the way from 1800 s ago to 300 s ago... computed below from the actual times
        const [row] = await client.query<{ price: number; flag: string }>(
            `SELECT share_to_usd AS price, toString(price_flag) AS flag FROM ${qualified(db.analytics, 'user_timeline_priced')} FINAL WHERE event_id = '${id}'`
        );
        expect(row?.flag).toBe('OK');
        expect(row?.price).toBeGreaterThan(5);
        expect(row?.price).toBeLessThan(6);
    });

    it('marks an event of an unknown contract missing instead of dropping it', async () => {
        await client.command(
            `INSERT INTO ${db.raw}.envio_history_BalanceChange VALUES
             ('orphan', '0xunknown', '${ACCOUNT}', '1', '1', 'TRANSFER', 100, '2024-01-01 10:00:00.000', '0xorphan', NULL, 1, 8453, 99, 'SET')`
        );
        await stampAll();
        expect(await stamped('orphan')).toMatchObject({ price: 0, flag: 'MISSING' });
    });

    it('writes nothing when nothing changed, so refreshing every 10 seconds does not grow the table', async () => {
        await stampAll();
        const before = await pricedRowCount();
        await stampAll();
        await stampAll();
        expect(await pricedRowCount()).toBe(before);
    });

    it('applies a price correction and a rollback to rows that were already stamped', async () => {
        const id = await event('2024-03-01 10:07:30.000', '1000000000000000000');
        await price('2024-03-01 10:00:00', 1);
        await price('2024-03-01 10:15:00', 2);
        await stampAll();
        expect(await stamped(id)).toMatchObject({ price: 1.5 });
        await client.command(
            `INSERT INTO ${db.prices}.int_product_share_price VALUES (8453, '${VAULT}', 'k', '2024-03-01 10:15:00', 4, 'correction', 2)`
        );
        await stampAll();
        expect(await stamped(id)).toMatchObject({ price: 2.5, source: 'test' });
        await event('2024-03-01 10:07:30.000', '1000000000000000000', 'DELETE', id);
        await stampAll();
        expect(await stamped(id)).toBeUndefined();
    });

    it('catches up an explicit range with the same statement', async () => {
        await client.command(`TRUNCATE TABLE ${qualified(db.analytics, 'user_timeline_priced')}`);
        await client.command(stampRangeStatement(db, '2024-01-01', '2024-01-02'));
        expect(await pricedRowCount()).toBeGreaterThan(0);
        expect(() => stampRangeStatement(db, "2024-01-01'; DROP", '2024-01-02')).toThrow('stamp range');
    });
});
