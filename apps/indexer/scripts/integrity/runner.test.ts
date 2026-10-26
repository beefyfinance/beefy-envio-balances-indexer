import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CatalogProduct, IndexedEntity } from './catalog';
import { COVERAGE_ENTITIES } from './catalog';
import { runIntegrityChecks } from './checks';
import {
    type ClickHouseClient,
    chainIn,
    clickHouseConfigFromEnv,
    createClickHouseClient,
    fetchContractIds,
    fetchIds,
} from './clickhouse';

const emptyIndexed = () => {
    const map = new Map<IndexedEntity, Set<string>>();
    for (const entity of COVERAGE_ENTITIES) {
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

const createMockClient = (onQuery?: (sql: string) => Record<string, unknown>[] | undefined): ClickHouseClient => ({
    async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
        const override = onQuery?.(sql);
        if (override) {
            return override as T[];
        }
        if (/\bAS count\b/.test(sql)) {
            return [{ count: '0' }] as unknown as T[];
        }
        return [];
    },
});

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
    it('reads config from env and builds IN lists', () => {
        expect(clickHouseConfigFromEnv({})).toEqual({
            url: 'http://localhost:8123',
            database: 'default',
            username: 'default',
            password: '',
        });
        expect(
            clickHouseConfigFromEnv({
                ENVIO_CLICKHOUSE_HOST: 'http://ch:8123',
                ENVIO_CLICKHOUSE_DATABASE: 'envio',
                ENVIO_CLICKHOUSE_USERNAME: 'user',
                ENVIO_CLICKHOUSE_PASSWORD: 'secret',
            })
        ).toEqual({
            url: 'http://ch:8123',
            database: 'envio',
            username: 'user',
            password: 'secret',
        });
        expect(chainIn('t.chain_id', [8453, 42161])).toBe('t.chain_id IN (8453,42161)');
    });

    it('collects ids from a table', async () => {
        const queries: string[] = [];
        const client = createMockClient((sql) => {
            queries.push(sql);
            if (sql.includes('SELECT id FROM Contract')) {
                return [{ id: '8453-0xabc' }, { id: '8453-0xdef' }];
            }
            return undefined;
        });
        await expect(fetchIds(client, 'Contract', [8453])).resolves.toEqual(new Set(['8453-0xabc', '8453-0xdef']));
        await expect(fetchContractIds(client, ['REWARD_POOL', 'BOOST'], [8453])).resolves.toHaveProperty('size', 2);
        expect(queries[1]).toBe(
            "SELECT id FROM Contract WHERE chain_id IN (8453) AND (kind IN ('REWARD_POOL','BOOST'))"
        );
    });
});

describe('createClickHouseClient', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts SQL as JSONEachRow and parses rows', async () => {
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : input.toString());
            expect(url.searchParams.get('database')).toBe('envio');
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
        const client = createClickHouseClient({
            url: 'http://localhost:8123',
            database: 'envio',
            username: 'user',
            password: 'secret',
        });
        await expect(client.query<{ id: string }>('SELECT id FROM Contract')).resolves.toEqual([
            { id: 'a' },
            { id: 'b' },
        ]);
    });

    it('surfaces ClickHouse HTTP errors', async () => {
        vi.stubGlobal('fetch', async () => ({ ok: false, status: 400, text: async () => 'syntax error' }) as Response);
        const client = createClickHouseClient(clickHouseConfigFromEnv({}));
        await expect(client.query('SELECT bad')).rejects.toThrow('ClickHouse query failed: 400 syntax error');
    });
});

describe('runIntegrityChecks', () => {
    it('returns only coverage summaries when probes are clean', async () => {
        const findings = await run(createMockClient());
        expect(findings.every((item) => item.check.endsWith('.summary'))).toBe(true);
        expect(findings).toHaveLength(COVERAGE_ENTITIES.length);
        expect(findings.find((item) => item.check === 'Classic.summary')?.sample[0]).toContain('missingActive=0');
    });

    it('scopes probe SQL to the chains and catalog ids and records sample hits', async () => {
        const queries: string[] = [];
        const client = createMockClient((sql) => {
            queries.push(sql);
            if (!sql.includes("relation = 'VAULT_WANT'")) return undefined;
            return /\bAS count\b/.test(sql) ? [{ count: '3' }] : [{ id: '8453-0xv1' }, { id: '8453-0xv2' }];
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
        const sql = queries.find((query) => query.includes("relation = 'VAULT_WANT'")) ?? '';
        expect(sql).toContain('t.chain_id IN (8453)');
        expect(sql).toContain(`t.id IN ('${classicProduct().id}')`);
    });

    it('reports ledger drift as an error and failed CLM reads as a warning', async () => {
        const client = createMockClient((sql) => {
            if (!/\bAS count\b/.test(sql)) return undefined;
            if (sql.includes('argMax(balance_after')) return [{ count: '2' }];
            if (sql.includes("t.status = 'FAILED'")) return [{ count: '1' }];
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
