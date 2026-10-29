import { type Sql, param, sql } from '@beefy/clickhouse';
import * as R from 'remeda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { loadScriptsConfig } from '../lib/config.ts';
import type { CatalogProduct, IndexedEntity } from './catalog.ts';
import { coverageEntities } from './catalog.ts';
import { runIntegrityChecks } from './checks.ts';
import { type ClickHouseClient, createClickHouseClient, fetchContractIds, fetchIds } from './clickhouse.ts';

const emptyIndexed = () => {
    const map = new Map<IndexedEntity, Set<string>>();
    for (const entity of coverageEntities()) {
        map.set(entity, new Set());
    }
    return map;
};

const classicProduct = (id = '8453-0x1111111111111111111111111111111111111111'): CatalogProduct => ({
    entity: 'Classic',
    id,
    chainId: 8453,
    address: id.slice(id.indexOf('-') + 1),
    beefyId: 'vault',
    status: 'active',
    live: true,
});

const createMockClient = (onQuery?: (statement: Sql) => Record<string, unknown>[] | undefined): ClickHouseClient => ({
    async query(statement, row) {
        const rows = onQuery?.(statement) ?? (/\bAS count\b/.test(statement.text) ? [{ count: '0' }] : []);
        return rows.map((value) => row.parse(value));
    },
});

/** Whether the statement sends `value` as one of its parameters. */
const sends = (statement: Sql, value: unknown) => R.values(statement.params).some((item) => R.isDeepEqual(item, value));

const run = (client: ClickHouseClient, overrides: Partial<Parameters<typeof runIntegrityChecks>[1]> = {}) =>
    runIntegrityChecks(client, {
        chainIds: [8453],
        sampleSize: 5,
        catalog: [classicProduct()],
        indexedByEntity: new Map([...emptyIndexed(), ['Classic', new Set([classicProduct().id])]]),
        blacklist: new Set(),
        ...overrides,
    });

describe('clickhouse helpers', () => {
    it('collects ids from a table, values as parameters', async () => {
        const queries: Sql[] = [];
        const client = createMockClient((statement) => {
            queries.push(statement);
            if (statement.text.includes('SELECT id FROM `Contract`')) {
                return [{ id: '8453-0xabc' }, { id: '8453-0xdef' }];
            }
            return undefined;
        });
        await expect(fetchIds(client, 'Contract', [8453])).resolves.toEqual(new Set(['8453-0xabc', '8453-0xdef']));
        await expect(fetchContractIds(client, ['REWARD_POOL', 'BOOST'], [8453])).resolves.toHaveProperty('size', 2);
        // oxlint-disable-next-line beefy/no-untagged-sql -- the expected text of a statement, compared as a string
        expect(queries[1]?.text).toBe(
            'SELECT id FROM `Contract` WHERE has({p_0:Array(Int64)}, toInt64(chain_id)) AND (has({p_1:Array(String)}, toString(kind)))'
        );
        expect(queries[1]?.params).toEqual({ p_0: [8453], p_1: ['REWARD_POOL', 'BOOST'] });
    });

    it('refuses a table name that is not a plain identifier', async () => {
        const client = createMockClient();
        await expect(fetchIds(client, 'Contract; DROP TABLE Token', [8453])).rejects.toThrow(
            'invalid ClickHouse identifier'
        );
        await expect(fetchIds(client, '`Contract`', [8453])).rejects.toThrow('invalid ClickHouse identifier');
    });
});

describe('createClickHouseClient', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const config = (env: Record<string, string> = {}) => loadScriptsConfig(env).clickhouse;

    it('posts SQL as JSONEachRow, values as query parameters, and validates rows', async () => {
        vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : input.toString());
            expect(url.searchParams.get('database')).toBe('envio');
            expect(url.searchParams.get('param_p_0')).toBe('[8453,10]');
            expect(url.searchParams.get('param_p_1')).toBe("['a\\'b','c\\\\d']");
            expect(url.searchParams.get('param_p_2')).toBe('x\\ty');
            expect(url.searchParams.get('param_p_3')).toBe("{'1':'a\\'b'}");
            expect(init?.method).toBe('POST');
            expect(init?.headers).toMatchObject({
                'x-clickhouse-user': 'user',
                'x-clickhouse-key': 'secret',
            });
            expect(init?.body).toContain('FORMAT JSONEachRow');
            return {
                ok: true,
                text: async () => '{"id":"a"}\n{"id":"b"}\n',
            } as Response;
        });
        const client = createClickHouseClient(
            config({
                ENVIO_CLICKHOUSE_DATABASE: 'envio',
                ENVIO_CLICKHOUSE_USERNAME: 'user',
                ENVIO_CLICKHOUSE_PASSWORD: 'secret',
            })
        );
        await expect(
            client.query(
                sql`SELECT id FROM Contract WHERE has(${param('Array(Int64)', [8453, 10])}, chain_id) AND has(${param('Array(String)', ["a'b", 'c\\d'])}, id)
                    AND name != ${param('String', 'x\ty')} AND ${param('Map(String, String)', new Map([['1', "a'b"]]))}['1'] != ''`,
                z.object({ id: z.string() })
            )
        ).resolves.toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('rejects rows of an unexpected shape and malformed parameter names', async () => {
        vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '{"id":1}\n' }) as Response);
        const client = createClickHouseClient(config());
        await expect(client.query(sql`SELECT id FROM Contract`, z.object({ id: z.string() }))).rejects.toThrow(
            'unexpected shape'
        );
        // @ts-expect-error a statement is built by the sql tag, never a string
        await expect(client.query('SELECT 1', z.object({ id: z.string() }))).rejects.toThrow('not a SQL statement'); // oxlint-disable-line beefy/no-untagged-sql -- the untagged string the client must refuse
    });

    it('surfaces ClickHouse HTTP errors', async () => {
        vi.stubGlobal('fetch', async () => ({ ok: false, status: 400, text: async () => 'syntax error' }) as Response);
        const client = createClickHouseClient(config());
        await expect(client.query(sql`SELECT bad`, z.object({}))).rejects.toThrow(
            'ClickHouse query failed: 400 syntax error'
        );
    });
});

describe('runIntegrityChecks', () => {
    it('returns only coverage summaries when probes are clean', async () => {
        const findings = await run(createMockClient());
        expect(findings.every((item) => item.check.endsWith('.summary'))).toBe(true);
        expect(findings).toHaveLength(coverageEntities().length);
        expect(findings.find((item) => item.check === 'Classic.summary')?.sample[0]).toContain('missingActive=0');
    });

    it('scopes probe SQL to the chains and catalog ids and records sample hits', async () => {
        const queries: Sql[] = [];
        const client = createMockClient((statement) => {
            queries.push(statement);
            if (!sends(statement, 'VAULT_WANT')) return undefined;
            return /\bAS count\b/.test(statement.text) ? [{ count: '3' }] : [{ id: '8453-0xv1' }, { id: '8453-0xv2' }];
        });
        const findings = await run(client);
        const hit = findings.find((item) => item.check === 'VAULT.missing-VAULT_WANT');
        expect(hit).toEqual({
            section: 'structure',
            severity: 'error',
            check: 'VAULT.missing-VAULT_WANT',
            count: 3,
            sample: ['8453-0xv1', '8453-0xv2'],
        });
        const query = queries.find((statement) => sends(statement, 'VAULT_WANT'));
        expect(query?.text).toMatch(/has\(\{p_\d+:Array\(Int64\)\}, toInt64\(`t`\.chain_id\)\)/);
        expect(query?.text).toMatch(/has\(\{p_\d+:Array\(String\)\}, toString\(t\.id\)\)/);
        for (const value of ['VAULT', [8453], [classicProduct().id]]) expect(query && sends(query, value)).toBe(true);
    });

    it('reports ledger drift as an error and failed CLM reads as a warning', async () => {
        const client = createMockClient((statement) => {
            if (!/\bAS count\b/.test(statement.text)) return undefined;
            if (statement.text.includes('argMax(balance_after')) return [{ count: '2' }];
            if (statement.text.includes('toString(t.status) = {') && sends(statement, 'FAILED'))
                return [{ count: '1' }];
            return undefined;
        });
        const findings = await run(client);
        expect(findings.find((item) => item.check === 'Balance.drift-from-last-change')).toMatchObject({
            section: 'sanity',
            severity: 'error',
            count: 2,
        });
        expect(findings.find((item) => item.check === 'ClmPoolState.read-failed')).toMatchObject({
            severity: 'warning',
            count: 1,
        });
    });
});
