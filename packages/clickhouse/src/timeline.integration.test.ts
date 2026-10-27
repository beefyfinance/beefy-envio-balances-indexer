import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createClickhouseClient } from './client.ts';
import { attach, migrate } from './migrate.ts';
import { productSharePriceStub } from './pricing.ts';
import { qualified } from './sql.ts';
import { createScratchRaw } from './testing.ts';

// Run with: CLICKHOUSE_URL=http://localhost:18123 CLICKHOUSE_TEST_RAW_DATABASE=<a database the indexer wrote> pnpm test:integration
const url = process.env['CLICKHOUSE_URL'];
const realRaw = process.env['CLICKHOUSE_TEST_RAW_DATABASE'];
const client = createClickhouseClient({ url: url ?? 'http://localhost:0', username: 'default', password: '' });

const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const loaded = { raw: realRaw ?? 'none', analytics: `test_an_${suffix}`, prices: `test_px_${suffix}` };
const scratch = { raw: `test_raw_${suffix}`, analytics: `test_an2_${suffix}`, prices: `test_px2_${suffix}` };

const count = async (database: string, table: string, where = '1'): Promise<number> => {
    const [row] = await client.query<{ n: string }>(
        `SELECT count() AS n FROM ${qualified(database, table)} FINAL WHERE is_deleted = 0 AND (${where})`
    );
    return Number(row?.n);
};

describe.skipIf(url === undefined || realRaw === undefined)('user_timeline over real indexer output', () => {
    beforeAll(async () => {
        await client.command(`CREATE DATABASE ${loaded.prices}`);
        await client.command(productSharePriceStub(loaded));
        await migrate(client, loaded);
        await attach(client, loaded);
    });
    afterAll(async () => {
        await client.command(`DROP DATABASE IF EXISTS ${loaded.analytics}`);
        await client.command(`DROP DATABASE IF EXISTS ${loaded.prices}`);
    });

    it('holds exactly one row per raw event of each kind', async () => {
        const raw = async (table: string): Promise<number> => {
            const [row] = await client.query<{ n: string }>(`SELECT count() AS n FROM ${qualified(loaded.raw, table)}`);
            return Number(row?.n);
        };
        expect(await count(loaded.analytics, 'user_timeline', "kind = 'BALANCE'")).toBe(await raw('BalanceChange'));
        expect(await count(loaded.analytics, 'user_timeline', "kind = 'CLM_DEPOSIT'")).toBe(await raw('ClmDeposit'));
        expect(await count(loaded.analytics, 'user_timeline', "kind = 'CLM_WITHDRAW'")).toBe(await raw('ClmWithdraw'));
        expect(await count(loaded.analytics, 'user_timeline', "kind = 'CLAIM'")).toBe(await raw('RewardPaid'));
        const [marks] = await client.query<{ mints: string; burns: string }>(
            `SELECT countIf(from_address = '0x0000000000000000000000000000000000000000') AS mints,
                countIf(to_address = '0x0000000000000000000000000000000000000000') AS burns
             FROM ${qualified(loaded.raw, 'ShareTransfer')}`
        );
        expect(await count(loaded.analytics, 'user_timeline', "kind = 'MINT'")).toBe(Number(marks?.mints));
        expect(await count(loaded.analytics, 'user_timeline', "kind = 'BURN'")).toBe(Number(marks?.burns));
    });

    it('keeps the sums of the raw amounts, so no value was silently zeroed', async () => {
        const [rawSum] = await client.query<{ delta: string; claims: string }>(
            `SELECT
                (SELECT sum(toInt256(delta)) FROM ${qualified(loaded.raw, 'BalanceChange')}) AS delta,
                (SELECT sum(toUInt256(amount)) FROM ${qualified(loaded.raw, 'RewardPaid')}) AS claims`
        );
        const [sum] = await client.query<{ delta: string; claims: string }>(
            `SELECT sumIf(delta, kind = 'BALANCE') AS delta, sumIf(reward_amount, kind = 'CLAIM') AS claims
             FROM ${qualified(loaded.analytics, 'user_timeline')} FINAL WHERE is_deleted = 0`
        );
        expect(sum).toEqual(rawSum);
    });

    it('running sum of deltas equals the balance the indexer recorded, per account and token', async () => {
        const rows = await client.query<{ wrong: string }>(
            `SELECT count() AS wrong FROM (
                SELECT account, contract, sum(delta) AS total, argMax(shares_after, (timestamp, log_index)) AS last_balance
                FROM ${qualified(loaded.analytics, 'user_timeline')} FINAL
                WHERE kind = 'BALANCE' AND is_deleted = 0 GROUP BY account, contract
                HAVING total != toInt256(last_balance))`
        );
        expect(Number(rows[0]?.wrong)).toBe(0);
    });

    it('answers an account with a sorted range read of its rows only', async () => {
        const [busiest] = await client.query<{ account: string }>(
            `SELECT account FROM ${qualified(loaded.analytics, 'user_timeline')} GROUP BY account ORDER BY count() DESC LIMIT 1`
        );
        const account = busiest?.account ?? '';
        const explain = await client.query<{ explain: string }>(
            `EXPLAIN indexes = 1 SELECT * FROM ${qualified(loaded.analytics, 'user_timeline')} WHERE account = '${account}'`
        );
        expect(explain.map((r) => r.explain).join('\n')).toMatch(/PrimaryKey[\s\S]*account/);
    });

    it('resolves every contract of a balance row to a product', async () => {
        const rows = await client.query<{ orphans: string }>(
            `SELECT countDistinct(t.contract) AS orphans
             FROM ${qualified(loaded.analytics, 'user_timeline')} AS t FINAL
             LEFT JOIN ${qualified(loaded.analytics, 'contract_product')} AS p ON p.chain_id = t.chain_id AND p.contract = t.contract
             WHERE t.kind = 'BALANCE' AND p.contract = ''`
        );
        expect(Number(rows[0]?.orphans)).toBe(0);
    });
});

describe.skipIf(url === undefined)('insert-time views and rollbacks', () => {
    beforeAll(async () => {
        await client.command(`CREATE DATABASE ${scratch.prices}`);
        await client.command(productSharePriceStub(scratch));
        await createScratchRaw(client, scratch.raw);
        await migrate(client, scratch);
        await attach(client, scratch);
    });
    afterAll(async () => {
        await client.command(`DROP DATABASE IF EXISTS ${scratch.raw}`);
        await client.command(`DROP DATABASE IF EXISTS ${scratch.analytics}`);
        await client.command(`DROP DATABASE IF EXISTS ${scratch.prices}`);
    });

    const insertBalance = (checkpoint: number, change: 'SET' | 'DELETE', ts: string): Promise<void> =>
        client.command(
            `INSERT INTO ${scratch.raw}.envio_history_BalanceChange VALUES
             ('8453-0xaa-1-0xAbC', '0xVAULT', '0xAbC', '-5', '95', 'TRANSFER', 100, '${ts}', '0xaa', NULL, 1, 8453, ${checkpoint}, '${change}')`
        );

    it('projects a new row as soon as it is inserted, lower-casing addresses', async () => {
        await insertBalance(1, 'SET', '2026-01-01 10:00:00.000');
        const [row] = await client.query<{
            account: string;
            contract: string;
            delta: string;
            shares_after: string;
            kind: string;
        }>(
            `SELECT account, contract, toString(delta) AS delta, toString(shares_after) AS shares_after, toString(kind) AS kind
             FROM ${scratch.analytics}.user_timeline FINAL WHERE is_deleted = 0`
        );
        expect(row).toEqual({
            account: '0xabc',
            contract: '0xvault',
            delta: '-5',
            shares_after: '95',
            kind: 'BALANCE',
        });
    });

    it('marks mints and burns by the account that received or gave up the shares', async () => {
        await client.command(
            `INSERT INTO ${scratch.raw}.envio_history_ShareTransfer VALUES
             ('t1', '0xVAULT', '0x0000000000000000000000000000000000000000', '0xAbC', '5', '5', 100, '2026-01-01 09:00:00.000', '0xt1', NULL, 1, 8453, 10, 'SET'),
             ('t2', '0xVAULT', '0xAbC', '0x0000000000000000000000000000000000000000', '5', '0', 101, '2026-01-01 09:30:00.000', '0xt2', NULL, 1, 8453, 11, 'SET'),
             ('t3', '0xVAULT', '0xAbC', '0xDef', '1', NULL, 102, '2026-01-01 09:40:00.000', '0xt3', NULL, 1, 8453, 12, 'SET')`
        );
        const rows = await client.query<{ kind: string; account: string; contract: string; delta: string }>(
            `SELECT toString(kind) AS kind, account, contract, toString(delta) AS delta
             FROM ${scratch.analytics}.user_timeline FINAL WHERE kind IN ('MINT', 'BURN') ORDER BY timestamp`
        );
        // a plain transfer between two accounts is neither
        expect(rows).toEqual([
            { kind: 'MINT', account: '0xabc', contract: '0xvault', delta: '0' },
            { kind: 'BURN', account: '0xabc', contract: '0xvault', delta: '0' },
        ]);
    });

    it('collapses a rollback tombstone with the row it cancels', async () => {
        await insertBalance(2, 'DELETE', '2026-01-01 10:00:00.000');
        expect(await count(scratch.analytics, 'user_timeline', "kind = 'BALANCE'")).toBe(0);
    });

    it('is not duplicated by a backfill over rows the views already saw', async () => {
        await insertBalance(3, 'SET', '2026-01-01 10:00:01.000');
        await attach(client, scratch);
        await attach(client, scratch);
        expect(
            await count(scratch.analytics, 'user_timeline', "event_id = '8453-0xaa-1-0xAbC' AND is_deleted = 0")
        ).toBe(1);
    });
});
