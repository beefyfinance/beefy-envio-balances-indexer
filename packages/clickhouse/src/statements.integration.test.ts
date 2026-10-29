import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createClickhouseClient } from './client.ts';
import { advance, deploy, migrate, readWatermark, reprice, rewind, switchVersion } from './deployments.ts';
import { integrationClickhouseUrl } from './lib/config.ts';
import { type Schema, ident, param, qualified, sql, timeOf } from './sql.ts';
import { seedSynthetic } from './synthetic.ts';
import { createScratchRaw, testRepriceSettings } from './testing.ts';
import { eventPriceTable, productContractsSelect, userTimelineApi } from './timeline.ts';

// Run with: CLICKHOUSE_URL=http://localhost:18123 pnpm test:integration
const url = integrationClickhouseUrl();
const client = createClickhouseClient({ url: url ?? 'http://localhost:0', username: 'default', password: '' });

const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const priceDatabase = `test_px_s${suffix}`;
const schema: Schema = {
    database: `test_bi_s${suffix}`,
    prices: { price5m: `${priceDatabase}.asset_price_5m`, token: `${priceDatabase}.token` },
    watermarkPriceSources: ['api'],
    envioDatabasePrefix: `test_envio_s${suffix}_`,
};
const raw = `test_envio_s${suffix}_1`;

/** Strings that would end a literal, a statement or an identifier, open a placeholder, or break a line. */
const HOSTILE = [
    "'",
    "\\'",
    '`',
    '"',
    ';',
    '{',
    '}',
    '{x:String}',
    '\n',
    '\r\n',
    '\t',
    '\\',
    '\\n',
    '\0',
    "'); DROP TABLE t; --",
    '/* */',
    'é😀',
];

describe.skipIf(url === undefined)('statements against ClickHouse', () => {
    beforeAll(async () => {
        await createScratchRaw(client, raw);
        // a small synthetic load: the seed's own SQL runs too
        await seedSynthetic(client, schema, raw, { accounts: 20, events: 3000, products: 4, days: 30 });
        await migrate(client, schema);
        await deploy(client, schema, 1, raw);
        await switchVersion(client, schema, 1, { ...testRepriceSettings(), force: true });
    });
    afterAll(async () => {
        for (const name of [raw, schema.database, priceDatabase])
            await client.command(sql`DROP DATABASE IF EXISTS ${ident(name)}`);
    });

    it('sends hostile values as parameters and gets them back unchanged', async () => {
        for (const value of HOSTILE) {
            const [row] = await client.query<{ s: string; a: string[]; m: Record<string, string> }>(
                sql`SELECT ${param('String', value)} AS s, ${param('Array(String)', [value, 'x'])} AS a,
                    ${param('Map(String, String)', new Map([[value, value]]))} AS m`
            );
            expect(row).toEqual({ s: value, a: [value, 'x'], m: { [value]: value } });
        }
    });

    it('inserts hostile values as JSON rows and reads them back unchanged', async () => {
        await client.command(sql`CREATE TABLE ${qualified(schema.database, 'hostile')} (s String) ENGINE = Memory`);
        await client.insert(
            qualified(schema.database, 'hostile'),
            HOSTILE.map((s) => ({ s }))
        );
        const rows = await client.query<{ s: string }>(sql`SELECT s FROM ${qualified(schema.database, 'hostile')}`);
        expect(rows.map(({ s }) => s).sort()).toEqual([...HOSTILE].sort());
    });

    it('treats a hostile account as an account: no row, no error', async () => {
        for (const account of HOSTILE) {
            const rows = await client.query(
                sql`SELECT * FROM ${qualified(schema.database, userTimelineApi())}(account = ${param('String', account)})`
            );
            expect(rows).toEqual([]);
        }
    });

    it('refuses hostile times and versions before reaching ClickHouse', async () => {
        const settings = testRepriceSettings();
        await expect(rewind(client, schema, 1, "2024-01-01'; DROP DATABASE default; --")).rejects.toThrow(
            'time must be'
        );
        await expect(reprice(client, schema, 1, '2024-01-01', '2024-01-02\n; DROP', settings)).rejects.toThrow(
            'time must be'
        );
        await expect(reprice(client, schema, Number.NaN, '2024-01-01', '2024-01-02', settings)).rejects.toThrow(
            'version must be'
        );
    });

    it('stores the same prices whether an advance runs in one statement or in many small ones', async () => {
        const small = { ...testRepriceSettings(), maxEventsPerStatement: 1000, stepDays: 3 };
        const [result] = await advance(client, schema, small);
        // 3000 events over 30 days: at least 3 statements by count, about 10 by span
        expect(result?.statements).toBeGreaterThanOrEqual(10);
        const snapshot = (): Promise<{ id: string; usd: number; flag: string }[]> =>
            client.query(
                sql`SELECT event_id AS id, share_to_usd AS usd, toString(price_flag) AS flag
                 FROM ${qualified(schema.database, eventPriceTable(1))} FINAL ORDER BY event_id`
            );
        const many = await snapshot();
        // every event of the seed below the watermark is stored, once
        const watermark = await readWatermark(client, schema, 1);
        const [below] = await client.query<{ n: string }>(
            sql`SELECT count() AS n FROM ${qualified(raw, 'envio_history_TimelineEvent')}
             WHERE block_timestamp < ${param("DateTime64(3, 'UTC')", watermark?.watermark ?? timeOf(0))} OR head_price IS NULL`
        );
        expect(many.length).toBe(Number(below?.n));
        // the same range again, in one statement
        const statements = await reprice(client, schema, 1, '2000-01-01', watermark?.watermark ?? '', {
            ...testRepriceSettings(),
            maxEventsPerStatement: 100_000,
        });
        expect(statements).toBe(1);
        expect(await snapshot()).toEqual(many);
    });

    it('lists the product contracts the API reads', async () => {
        const rows = await client.query<{ contract: string }>(productContractsSelect(schema.database));
        expect(rows).toHaveLength(4);
    });
});
