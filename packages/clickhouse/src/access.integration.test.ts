import { randomUUID } from 'node:crypto';

import * as R from 'remeda';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { accessStatements } from './access.ts';
import { createClickhouseClient } from './client.ts';
import { advance, cleanup, deploy, markReady, migrate, switchVersion } from './deployments.ts';
import { integrationClickhouseUrl } from './lib/config.ts';
import { apiStatus } from './monitoring.ts';
import { priceStubs } from './pricing.ts';
import { type Schema, ident, param, qualified, qualifiedName, sql } from './sql.ts';
import {
    commitCheckpoint,
    createScratchRaw,
    insertTimelineEvents,
    testRepriceSettings,
    timelineEvent,
} from './testing.ts';
import { apiStatusSelect, eventPriceTable, userTimelineApi } from './timeline.ts';

// Needs a ClickHouse whose default user may manage access: CLICKHOUSE_URL=http://localhost:18123
const url = integrationClickhouseUrl();
const admin = createClickhouseClient({ url: url ?? 'http://localhost:0', username: 'default', password: '' });

const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const users = { pipeline: `pipe_${suffix}`, api: `api_${suffix}` };
// characters that would end a quoted string or a statement: they travel hashed, as a parameter (no line break: the
// password also travels in an HTTP header)
const secrets = { pipeline: `pipeline'-${suffix}-"secret";--{x}`, api: `api\\-${suffix}-\`secret\`;0002` };
const priceDatabase = `acc_px_${suffix}`;
const envioPrefix = `acc_envio_${suffix}_`;
const raw1 = `${envioPrefix}1`;
const raw2 = `${envioPrefix}2`;
const schema: Schema = {
    database: `acc_bi_${suffix}`,
    prices: { price5m: `${priceDatabase}.asset_price_5m`, token: `${priceDatabase}.token` },
    watermarkPriceSources: ['api'],
    definer: users.pipeline,
    envioDatabasePrefix: envioPrefix,
};

const settings = testRepriceSettings();
const gate = settings;

const as = (name: 'pipeline' | 'api') =>
    createClickhouseClient({
        url: url ?? 'http://localhost:0',
        username: users[name],
        password: secrets[name],
        readonly: name === 'api',
    });

describe.skipIf(url === undefined)('access', () => {
    beforeAll(async () => {
        for (const statement of accessStatements(schema, {
            pipelineUser: users.pipeline,
            apiUser: users.api,
            pipelinePassword: secrets.pipeline,
            apiPassword: secrets.api,
            envioDatabasePrefix: envioPrefix,
        })) {
            await admin.command(statement);
        }
        await admin.command(sql`CREATE DATABASE ${ident(priceDatabase)}`);
        for (const statement of priceStubs(schema.prices)) await admin.command(statement);
        await admin.insert(qualified(priceDatabase, 'token'), [
            { chain_id: 8453, representation_address: '0xvault', decimals: 18, asset_id: 1 },
        ]);
        await admin.insert(qualified(priceDatabase, 'asset_price_5m'), [
            { asset_id: 1, date_time: '2026-01-01 09:45:00', price: 2, price_source: 'api' },
        ]);
        // Envio's databases, written by Envio's own user (the admin here)
        for (const raw of [raw1, raw2]) {
            await createScratchRaw(admin, raw);
            await admin.insert(qualified(raw, 'Contract'), [{ chain_id: 8453, address: '0xvault', kind: 'VAULT' }]);
            await insertTimelineEvents(admin, raw, [
                timelineEvent({
                    id: 'a1',
                    account: '0xabc',
                    contract: '0xvault',
                    delta: '5',
                    shares_after: '5',
                    block_number: 100,
                    block_timestamp: '2026-01-01 10:00:00.000',
                }),
            ]);
            await commitCheckpoint(admin, raw, 8453, 1);
        }
    });
    afterAll(async () => {
        for (const name of [raw1, raw2, schema.database, priceDatabase])
            await admin.command(sql`DROP DATABASE IF EXISTS ${ident(name)}`);
        for (const user of R.values(users)) await admin.command(sql`DROP USER IF EXISTS ${ident(user)}`);
        for (const profile of [`${users.pipeline}_profile`, `${users.api}_profile`]) {
            await admin.command(sql`DROP SETTINGS PROFILE IF EXISTS ${ident(profile)}`);
        }
        await admin.command(sql`DROP QUOTA IF EXISTS ${ident(`${users.api}_quota`)}`);
    });

    it('lets the pipeline user run every operation: deploy, advance, switch (as the views definer) and cleanup', async () => {
        const pipeline = as('pipeline');
        await migrate(pipeline, schema);
        await deploy(pipeline, schema, 1, raw1);
        await advance(pipeline, schema, settings);
        await switchVersion(pipeline, schema, 1, { ...gate, force: true });
        await deploy(pipeline, schema, 2, raw2);
        // its event has a price only once an advance has run (a provisional row: the watermark cannot pass it, its
        // price source is older than 30 days). The reprice statements send their limits, within the profile's
        await advance(pipeline, schema, settings);
        await markReady(pipeline, schema, 2, gate);
        await switchVersion(pipeline, schema, 2, gate);
        const report = await cleanup(pipeline, schema, { graceHours: 0 });
        expect(report.dropped).toEqual(['version 1: tables', `version 1: ${raw1}`]);
        await expect(pipeline.query(sql`SELECT 1 FROM system.one`)).resolves.toBeDefined();
        // it cannot touch a database outside its prefixes
        await expect(pipeline.command(sql`DROP DATABASE ${ident(priceDatabase)}`)).rejects.toThrow(/privileges/i);
        // nor raise its limits above the profile's
        await expect(pipeline.query(sql`SELECT 1`, { settings: { max_memory_usage: 9_000_000_000 } })).rejects.toThrow(
            /max_memory_usage/
        );
    });

    it('gives the API user the views and nothing else, and no way to raise its limits', async () => {
        const api = as('api');
        // the account travels as a query parameter: a readonly user may send those (they are not settings)
        const rows = await api.query<{ share_to_usd: number }>(
            sql`SELECT share_to_usd FROM ${qualified(schema.database, userTimelineApi())}(account = ${param('String', '0xabc')})`
        );
        expect(rows).toEqual([{ share_to_usd: 2 }]);
        await expect(apiStatus(api, schema, 3000)).resolves.toMatchObject({ version: 2 });
        // and reads the API's queries in ArrowStream (the format is in the statement, not a setting)
        const chunks: Uint8Array[] = [];
        for await (const chunk of await api.stream(sql`${apiStatusSelect(schema.database)}\nFORMAT ArrowStream`))
            chunks.push(chunk as Uint8Array);
        expect(Buffer.concat(chunks).subarray(0, 4)).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff]));
        // uncompressed, as the profile says
        const [profile] = await api.query<{ method: string }>(
            sql`SELECT getSetting('output_format_arrow_compression_method') AS method`
        );
        expect(profile?.method).toBe('none');
        // and the client sent no setting of its own (a readonly user would have refused any): only the profile's (the
        // API user is this run's own, so the probe comment need not be unique)
        await api.query(sql`SELECT 1 AS one /* readonly-probe */`);
        await admin.command(sql`SYSTEM FLUSH LOGS`);
        const [logged] = await admin.query<{ names: string[] }>(
            sql`SELECT mapKeys(Settings) AS names FROM system.query_log
             WHERE type = 'QueryFinish' AND user = ${param('String', users.api)} AND position(query, 'readonly-probe') > 0`
        );
        expect(logged?.names.sort()).toEqual(
            [
                'max_bytes_to_read',
                'max_concurrent_queries_for_user',
                'max_execution_time',
                'max_memory_usage',
                'max_rows_to_read',
                'max_threads',
                'output_format_arrow_compression_method',
                'readonly',
            ].sort()
        );
        await expect(api.query(sql`SELECT 1 FROM ${qualified(schema.database, eventPriceTable(2))}`)).rejects.toThrow(
            /privileges/i
        );
        await expect(api.query(sql`SELECT 1 FROM ${qualified(raw2, 'Contract')}`)).rejects.toThrow(/privileges/i);
        await expect(api.query(sql`SELECT 1 FROM ${qualifiedName(schema.prices.price5m)}`)).rejects.toThrow(
            /privileges/i
        );
        await expect(api.command(sql`DROP TABLE ${qualified(schema.database, 'deployments')}`)).rejects.toThrow(
            /privileges|readonly/i
        );
        await expect(api.query(sql`SELECT 1`, { settings: { max_execution_time: 100 } })).rejects.toThrow(
            /constraint|max_execution_time|readonly/i
        );
        await expect(
            api.query(sql`SELECT 1`, { settings: { output_format_json_quote_64bit_integers: 1 } })
        ).rejects.toThrow(/readonly/i);
    });

    it('refuses a password too short, and a prefix that is not a plain name', () => {
        const options = { apiPassword: secrets.api, envioDatabasePrefix: envioPrefix };
        expect(() => accessStatements(schema, { ...options, pipelinePassword: 'short' })).toThrow('at least 16');
        expect(() =>
            accessStatements(schema, { ...options, pipelinePassword: secrets.pipeline, envioDatabasePrefix: 'a;b' })
        ).toThrow('invalid ClickHouse identifier');
    });
});
