import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProduct, IndexedEntity } from './catalog';
import { COVERAGE_ENTITIES } from './catalog';
import { runIntegrityChecks } from './checks';
import {
    type ClickHouseClient,
    chainIn,
    clickHouseConfigFromEnv,
    createClickHouseClient,
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
        if (sql.includes('FROM ClockTick') && sql.includes('INTERVAL 2 HOUR') && /\bAS count\b/.test(sql)) {
            return [{ count: '1' }] as unknown as T[];
        }
        if (/\bAS count\b/.test(sql)) {
            return [{ count: '0' }] as unknown as T[];
        }
        if (/\bAS latest\b/.test(sql)) {
            return [{ latest: '2026-09-23 16:00:00.000' }] as unknown as T[];
        }
        return [];
    },
});

const run = (client: ClickHouseClient, overrides: Partial<Parameters<typeof runIntegrityChecks>[1]> = {}) =>
    runIntegrityChecks(client, {
        chainIds: [8453],
        sampleSize: 5,
        stuckThreshold: 10,
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
        const client = createMockClient((sql) => {
            if (sql.includes('SELECT id FROM Classic')) {
                return [{ id: '8453-0xabc' }, { id: '8453-0xdef' }];
            }
            return undefined;
        });
        await expect(fetchIds(client, 'Classic', [8453])).resolves.toEqual(new Set(['8453-0xabc', '8453-0xdef']));
    });
});

describe('createClickHouseClient', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts SQL as JSONEachRow and parses rows', async () => {
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input));
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
        await expect(client.query<{ id: string }>('SELECT id FROM Classic')).resolves.toEqual([
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
    it('returns only coverage summaries when probes and ledgers are clean', async () => {
        const findings = await run(createMockClient());
        expect(findings.every((item) => item.check.endsWith('.summary'))).toBe(true);
        expect(findings).toHaveLength(COVERAGE_ENTITIES.length);
        expect(findings.find((item) => item.check === 'Classic.summary')?.sample[0]).toContain('missingActive=0');
    });

    it('scopes probe SQL to catalog ids and records sample hits', async () => {
        const seen: string[] = [];
        const client = createMockClient((sql) => {
            seen.push(sql);
            if (
                sql.includes('t.classic_vault_id IS NULL OR t.classic_vault_id = ') &&
                sql.includes('FROM Classic AS t')
            ) {
                if (/\bAS count\b/.test(sql)) {
                    return [{ count: '2' }];
                }
                if (sql.includes('SELECT t.id AS id')) {
                    return [{ id: '8453-0x1111111111111111111111111111111111111111' }, { id: '8453-0xextra' }];
                }
            }
            return undefined;
        });
        const findings = await run(client);
        const missingVault = findings.find((item) => item.check === 'classic.missing-vault');
        expect(missingVault).toMatchObject({ section: 'structure', severity: 'error', count: 2 });
        expect(missingVault?.sample).toEqual(['8453-0x1111111111111111111111111111111111111111', '8453-0xextra']);
        expect(seen.some((sql) => sql.includes("t.id IN ('8453-0x1111111111111111111111111111111111111111')"))).toBe(
            true
        );
    });

    it('escalates stuck initializing products past the threshold', async () => {
        const stuckSql = (sql: string) =>
            sql.includes("t.initializable_status = 'INITIALIZING'") && sql.includes('INTERVAL 24 HOUR');
        const warning = await run(
            createMockClient((sql) => {
                if (stuckSql(sql) && sql.includes('FROM Classic AS t') && /\bAS count\b/.test(sql)) {
                    return [{ count: '3' }];
                }
                if (stuckSql(sql) && sql.includes('FROM Classic AS t')) {
                    return [{ id: '8453-0xstuck' }];
                }
                return undefined;
            })
        );
        expect(warning.find((item) => item.check === 'products.stuck-initializing')).toMatchObject({
            severity: 'warning',
            count: 3,
            sample: ['Classic 8453-0xstuck'],
        });

        const error = await run(
            createMockClient((sql) => {
                if (stuckSql(sql) && /\bAS count\b/.test(sql)) {
                    return [{ count: '2' }];
                }
                if (stuckSql(sql)) {
                    return [{ id: '8453-0xstuck' }];
                }
                return undefined;
            }),
            { stuckThreshold: 10 }
        );
        expect(error.find((item) => item.check === 'products.stuck-initializing')).toMatchObject({
            severity: 'error',
            count: 20,
        });
    });

    it('flags missing recent snapshots, stale clock ticks, and ledger drift', async () => {
        const client = createMockClient((sql) => {
            if (sql.includes('max(rounded_timestamp)') && sql.includes('ClassicSnapshot')) {
                return [{ latest: '1970-01-01 00:00:00.000' }];
            }
            if (
                sql.includes('FROM Classic WHERE') &&
                sql.includes("initializable_status = 'INITIALIZED'") &&
                sql.includes('vault_token_total_supply')
            ) {
                return [{ id: classicProduct().id }];
            }
            if (sql.includes('FROM ClockTick') && sql.includes('max(rounded_timestamp)')) {
                return [{ latest: '2020-01-01 00:00:00.000' }];
            }
            if (sql.includes('FROM ClockTick') && sql.includes('INTERVAL 2 HOUR') && /\bAS count\b/.test(sql)) {
                return [{ count: '0' }];
            }
            if (sql.includes('SELECT DISTINCT') && sql.includes('AS id')) {
                return [{ id: '8453-0xtoken' }];
            }
            if (sql.includes('FROM TokenBalance AS tb') && sql.includes('< 0') && /\bAS count\b/.test(sql)) {
                return [{ count: '4' }];
            }
            if (sql.includes('FROM TokenBalance AS tb') && sql.includes('< 0')) {
                return [{ id: '8453-0xtoken-0xuser' }];
            }
            return undefined;
        });
        const findings = await run(client);
        const byCheck = Object.fromEntries(findings.map((item) => [item.check, item]));
        expect(byCheck['Classic.missing-recent-snapshot']).toMatchObject({
            severity: 'warning',
            count: 1,
            sample: [classicProduct().id],
        });
        expect(byCheck['clockTick.stale-hourly']).toMatchObject({
            severity: 'warning',
            count: 1,
        });
        expect(byCheck['clockTick.stale-hourly']?.sample[0]).toContain('8453');
        expect(byCheck['tokenBalance.negative-amount']).toMatchObject({
            severity: 'warning',
            count: 4,
            sample: ['8453-0xtoken-0xuser'],
        });
    });

    it('reports array alignment and unexpected clock periods', async () => {
        const client = createMockClient((sql) => {
            if (sql.includes('length(t.underlying_breakdown_token_ids)') && sql.includes('FROM Classic AS t')) {
                if (/\bAS count\b/.test(sql)) {
                    return [{ count: '1' }];
                }
                return [{ id: classicProduct().id }];
            }
            if (sql.includes("period != '3600'") && sql.includes('FROM ClockTick')) {
                if (/\bAS count\b/.test(sql)) {
                    return [{ count: '2' }];
                }
                return [{ id: '8453-86400-1' }];
            }
            return undefined;
        });
        const findings = await run(client);
        const byCheck = Object.fromEntries(findings.map((item) => [item.check, item]));
        expect(byCheck['classic.array-alignment']).toMatchObject({ section: 'structure', severity: 'error', count: 1 });
        expect(byCheck['clockTick.unexpected-period']).toMatchObject({
            section: 'structure',
            severity: 'error',
            count: 2,
            sample: ['8453-86400-1'],
        });
    });
});
