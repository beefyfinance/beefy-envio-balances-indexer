import { randomUUID } from 'node:crypto';

import { attach, createClickhouseClient, migrate, productSharePriceStub, qualified } from '@beefy/clickhouse';
import { createScratchRaw } from '@beefy/clickhouse/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.ts';
import { createRateLimiter } from './http/rateLimit.ts';
import { clickhouseTimelineRepository } from './timeline/repository.ts';
import { createTimelineService } from './timeline/service.ts';

// The whole path: indexer rows → user_timeline → stamped user_timeline_priced → repository → response.
const url = process.env['CLICKHOUSE_URL'];
const client = createClickhouseClient({ url: url ?? 'http://localhost:0', username: 'default', password: '' });
const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const db = { raw: `api_raw_${suffix}`, analytics: `api_an_${suffix}`, prices: `api_px_${suffix}` };

const VAULT = '0x00000000000000000000000000000000000000bb';
const BOOST = '0x00000000000000000000000000000000000000cc';
const ACCOUNT = '0x00000000000000000000000000000000000000aa';

let checkpoint = 0;
const change = (
    id: string,
    token: string,
    delta: string,
    after: string,
    at: string,
    source = 'TRANSFER',
    trx = id
): Promise<void> =>
    client.command(
        `INSERT INTO ${db.raw}.envio_history_BalanceChange VALUES
         ('${id}', '${token}', '${ACCOUNT.toUpperCase().replace('0X', '0x')}', '${delta}', '${after}', '${source}', 100, '${at}', '0x${trx}', NULL, 1, 8453, ${(checkpoint += 1)}, 'SET')`
    );

describe.skipIf(url === undefined)('timeline over ClickHouse', () => {
    beforeAll(async () => {
        await client.command(`CREATE DATABASE ${db.prices}`);
        await client.command(productSharePriceStub(db));
        await createScratchRaw(client, db.raw);
        await client.command(`INSERT INTO ${db.raw}.Contract VALUES (8453, '${VAULT}', 'VAULT')`);
        await client.command(`INSERT INTO ${db.raw}.Token VALUES (8453, '${VAULT}', 18)`);
        await client.command(
            `INSERT INTO ${db.raw}.ContractLink VALUES (8453, '${BOOST}', '${VAULT}', 'BOOST_STAKED')`
        );
        for (const [at, price] of [
            ['2024-01-01 10:00:00', 1],
            ['2024-01-02 10:00:00', 2],
            ['2024-01-03 10:00:00', 4],
        ] as const) {
            await client.command(
                `INSERT INTO ${db.prices}.int_product_share_price VALUES (8453, '${VAULT}', 'k', '${at}', ${price}, 'test', 1)`
            );
        }
        await migrate(client, db);
        await attach(client, db);
        // deposit 10, then stake 4 of them in a boost, then withdraw 2
        await change('d1', VAULT, `${10n * 10n ** 18n}`, `${10n * 10n ** 18n}`, '2024-01-01 12:00:00.000');
        await change(
            's1',
            VAULT,
            `${-4n * 10n ** 18n}`,
            `${6n * 10n ** 18n}`,
            '2024-01-02 10:00:00.000',
            'TRANSFER',
            'stake'
        );
        await change(
            's2',
            BOOST,
            `${4n * 10n ** 18n}`,
            `${4n * 10n ** 18n}`,
            '2024-01-02 10:00:00.000',
            'BOOST_STAKE',
            'stake'
        );
        await change('w1', VAULT, `${-2n * 10n ** 18n}`, `${4n * 10n ** 18n}`, '2024-01-03 10:00:00.000');
        // the deposit minted its shares and the withdrawal burned them
        await client.command(
            `INSERT INTO ${db.raw}.envio_history_ShareTransfer VALUES
             ('m1', '${VAULT}', '0x0000000000000000000000000000000000000000', '${ACCOUNT}', '${10n * 10n ** 18n}', NULL, 100, '2024-01-01 12:00:00.000', '0xd1', NULL, 0, 8453, 90, 'SET'),
             ('b1', '${VAULT}', '${ACCOUNT}', '0x0000000000000000000000000000000000000000', '${2n * 10n ** 18n}', NULL, 100, '2024-01-03 10:00:00.000', '0xw1', NULL, 0, 8453, 91, 'SET')`
        );
        await client.command(`SYSTEM REFRESH VIEW ${qualified(db.analytics, 'mv_stamp_recent')}`);
        await client.command(`SYSTEM WAIT VIEW ${qualified(db.analytics, 'mv_stamp_recent')}`);
    });
    afterAll(async () => {
        for (const name of [db.raw, db.analytics, db.prices]) await client.command(`DROP DATABASE IF EXISTS ${name}`);
    });

    const appFor = () => {
        const service = createTimelineService({
            repository: clickhouseTimelineRepository(client, db.analytics, 5000),
            cacheBytes: 10_000_000,
            missesPerMinute: 600,
            missBurst: 100,
            maxInFlight: 4,
            maxQueue: 4,
            maxQueueWaitMs: 100,
        });
        return createApp({
            timeline: {
                service,
                blocked: () => new Set(),
                clientLimiter: createRateLimiter({ ratePerMinute: 6000, burst: 100 }),
                cloudflare: undefined,
            },
        });
    };

    it('serves the history newest first with interpolated prices and the product balance across vault and boost', async () => {
        const response = await appFor().request(`/v1/users/${ACCOUNT}/timeline`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
            count: number;
            items: {
                datetime: string;
                actions: string[];
                share_balance: string;
                share_diff: string;
                usd_balance: number;
                usd_diff: number;
                price: { share_to_usd: number; flag: string };
            }[];
        };
        expect(body.count).toBe(3);
        const [withdraw, stake, deposit] = body.items;
        expect(deposit).toMatchObject({
            actions: ['deposit'],
            share_balance: '10',
            share_diff: '10',
            price: { flag: 'STALE' },
        });
        // the prices are a day apart (more than the trusted gap), so the value is interpolated but flagged stale:
        // 12:00 is two hours into the day between prices 1 and 2
        expect(deposit?.price.share_to_usd).toBeCloseTo(1 + 2 / 24, 6);
        expect(stake).toMatchObject({
            actions: ['stake'],
            share_balance: '10',
            share_diff: '0',
            price: { share_to_usd: 2, flag: 'OK' },
        });
        expect(withdraw).toMatchObject({
            actions: ['withdraw'],
            share_balance: '8',
            share_diff: '-2',
            usd_balance: 32,
            usd_diff: -8,
        });
    });

    it('returns an empty timeline for an account with no events', async () => {
        const response = await appFor().request(`/v1/users/0x${'1'.repeat(40)}/timeline`);
        expect(await response.json()).toMatchObject({ count: 0, items: [] });
    });

    it('knows the product contracts, so they are not served as users', async () => {
        const contracts = await clickhouseTimelineRepository(client, db.analytics, 5000).productContracts();
        expect(contracts.sort()).toEqual([VAULT, BOOST]);
    });
});
