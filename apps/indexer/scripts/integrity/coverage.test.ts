import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { param, sql } from '@beefy/clickhouse';
import { addressBookByChainId } from '@beefyfinance/blockchain-addressbook';
import * as R from 'remeda';
import { describe, expect, it } from 'vitest';

import {
    addressbookConfigFactories,
    beefyNetworkChainIds,
    type CatalogProduct,
    coverageEntities,
    entityKinds,
    type IndexedEntity,
    isConfiguredAddress,
    loadActiveChainIds,
    loadConfiguredContracts,
    loadConfiguredLstVaults,
    loadConfiguredSwappers,
    loadVaultBlacklist,
    productId,
} from './catalog.ts';
import {
    allProbes,
    diffCoverage,
    int256,
    probeQueries,
    probeWhere,
    requiredLinks,
    sanityProbes,
    shareTokenKinds,
    structureProbes,
    scopePredicate,
    tokenKey,
} from './checks.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const product = (overrides: Partial<CatalogProduct> & Pick<CatalogProduct, 'entity' | 'id'>): CatalogProduct => ({
    chainId: 8453,
    address: overrides.id.split('-')[1] ?? '0x0',
    beefyId: 'vault',
    status: 'active',
    live: true,
    ...overrides,
});

describe('integrity catalog parsers', () => {
    const configYaml = readFileSync(join(repoRoot, 'config.yaml'), 'utf8');
    const blacklistSource = readFileSync(join(repoRoot, 'src/lib/blacklist.ts'), 'utf8');

    it('reads uncommented network ids and maps them to Beefy networks', () => {
        const chainIds = loadActiveChainIds(configYaml);
        expect(chainIds).toContain(8453);
        expect(chainIds).toContain(4663);
        expect(chainIds).not.toContain(250);
        for (const chainId of chainIds) {
            expect(R.values(beefyNetworkChainIds())).toContain(chainId);
        }
    });

    it('loads configured LST vaults and the vault blacklist', () => {
        const lsts = loadConfiguredLstVaults(configYaml);
        expect(lsts).toEqual(
            expect.arrayContaining([
                { chainId: 43114, address: '0x2e360492120cebeb2527c41bae1a4f21992d86ec' },
                { chainId: 10, address: '0x2489f2f7f972ca7ee6436666a3ab0aafb5a06c7b' },
                { chainId: 137, address: '0x5d060698f179e7d2233480a44d6d3979e4ae9e7f' },
            ])
        );
        expect(loadConfiguredContracts(configYaml, 'LstVault')).toEqual(lsts);
        const blacklist = loadVaultBlacklist(blacklistSource);
        expect(blacklist.length).toBeGreaterThan(200);
        expect(blacklist).toEqual(
            expect.arrayContaining([{ chainId: 10, address: '0x07ae77025feaf04f915375bc5f02c07545160db8' }])
        );
    });

    it('loads uncommented BeefySwapper addresses and skips commented chains', () => {
        const swappers = loadConfiguredSwappers(configYaml);
        expect(swappers).toEqual(
            expect.arrayContaining([
                { chainId: 8453, address: '0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc' },
                { chainId: 4326, address: '0xea13a590efd8545a10134d08081d6fc2fa0417a7' },
                { chainId: 42161, address: '0xcee843cd04e3758ddc5bcff08647dddb117151d0' },
            ])
        );
        expect(loadConfiguredContracts(configYaml, 'BeefySwapper')).toEqual(swappers);

        const withCommentedChain = [
            'chains:',
            '  - id: 1 # ethereum',
            '    contracts:',
            '      - name: BeefySwapper',
            '        address:',
            '          - 0x0000830df56616d58976a12d19d283b40e25beef',
            '  # - id: 80094 # berachain',
            '  #   contracts:',
            '  #     - name: BeefySwapper',
            '  #       address:',
            '  #         - 0xbc4a342b0c057501e081484a2d24e576e854f823',
        ].join('\n');
        expect(loadConfiguredSwappers(withCommentedChain)).toEqual([
            { chainId: 1, address: '0x0000830df56616d58976a12d19d283b40e25beef' },
        ]);
    });

    it('includes every addressbook factory for active chains', () => {
        const missing: string[] = [];
        for (const chainId of loadActiveChainIds(configYaml)) {
            const beefy =
                addressBookByChainId[String(chainId) as keyof typeof addressBookByChainId]?.platforms?.beefyfinance;
            if (!beefy) {
                continue;
            }
            for (const { contract, field } of addressbookConfigFactories()) {
                const address = beefy[field];
                if (!isConfiguredAddress(address)) {
                    continue;
                }
                const configured = loadConfiguredContracts(configYaml, contract)
                    .filter((entry) => entry.chainId === chainId)
                    .map((entry) => entry.address);
                if (!configured.includes(address.toLowerCase())) {
                    missing.push(`${chainId} ${contract} ${address.toLowerCase()}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });
});

describe('integrity coverage diff', () => {
    const indexed = (entries: Partial<Record<IndexedEntity, string[]>>) => {
        const map = new Map<IndexedEntity, Set<string>>();
        for (const entity of coverageEntities()) {
            map.set(entity, new Set(entries[entity] ?? []));
        }
        return map;
    };

    it('fails on missing active products, warns on eol, and lists blacklist hits separately', () => {
        const active = product({ entity: 'Classic', id: '8453-0xactive' });
        const eol = product({ entity: 'Classic', id: '8453-0xeol', status: 'eol', live: false, beefyId: 'old' });
        const blocked = product({ entity: 'Classic', id: '8453-0xblocked', beefyId: 'broken' });
        const findings = diffCoverage(
            [active, eol, blocked],
            indexed({ Classic: ['8453-0xextra'] }),
            new Set([productId(8453, '0xblocked')]),
            20
        );

        const byCheck = R.indexBy(findings, (item) => item.check);
        expect(byCheck['Classic.missing-active']).toMatchObject({ severity: 'error', count: 1 });
        expect(byCheck['Classic.missing-eol']).toMatchObject({ severity: 'warning', count: 1 });
        expect(byCheck['Classic.blacklisted']).toMatchObject({ severity: 'info', count: 1 });
        expect(byCheck['Classic.extra']).toBeUndefined();
        expect(byCheck['Classic.summary']?.sample[0]).toContain('extra=1');
    });

    it('does not report a blacklisted product that was indexed anyway', () => {
        const blocked = product({ entity: 'Clm', id: '8453-0xblocked' });
        const findings = diffCoverage([blocked], indexed({ Clm: [blocked.id] }), new Set([blocked.id]), 20);
        expect(findings.find((item) => item.check === 'Clm.blacklisted')).toBeUndefined();
        expect(findings.find((item) => item.check === 'Clm.missing-active')).toBeUndefined();
    });

    it('warns on missing configured swappers and still ignores extras', () => {
        const configured = product({
            entity: 'Swapper',
            id: '8453-0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc',
            beefyId: 'config.yaml BeefySwapper',
            status: 'configured',
        });
        const findings = diffCoverage([configured], indexed({ Swapper: ['8453-0xextra'] }), new Set(), 20);
        const byCheck = R.indexBy(findings, (item) => item.check);
        expect(byCheck['Swapper.missing-configured']).toMatchObject({ severity: 'warning', count: 1 });
        expect(byCheck['Swapper.missing-active']).toBeUndefined();
        expect(byCheck['Swapper.extra']).toBeUndefined();
        expect(byCheck['Swapper.summary']?.sample[0]).toContain('extra=1');
    });

    it('treats paused as live and closed as eol, and truncates samples', () => {
        const paused = product({ entity: 'RewardPool', id: '8453-0xpaused', status: 'paused', live: true });
        const closed = product({
            entity: 'RewardPool',
            id: '8453-0xclosed',
            status: 'eol',
            live: false,
            beefyId: 'retired',
        });
        const missing = Array.from({ length: 3 }, (_, index) =>
            product({ entity: 'LstVault', id: `8453-0xmiss${index}`, beefyId: `lst-${index}` })
        );
        const findings = diffCoverage([paused, closed, ...missing], indexed({}), new Set(), 2);
        const byCheck = R.indexBy(findings, (item) => item.check);
        expect(byCheck['RewardPool.missing-active']).toMatchObject({ severity: 'error', count: 1 });
        expect(byCheck['RewardPool.missing-eol']).toMatchObject({ severity: 'warning', count: 1 });
        expect(byCheck['LstVault.missing-active']).toMatchObject({ severity: 'error', count: 3 });
        expect(byCheck['LstVault.missing-active']?.sample).toHaveLength(2);
        expect(findings.filter((item) => item.check.endsWith('.extra'))).toEqual([]);
    });

    it('emits only per-entity summaries when the catalog is fully indexed', () => {
        const rows = [
            product({ entity: 'Classic', id: '8453-0xclassic' }),
            product({ entity: 'Clm', id: '8453-0xclm' }),
            product({ entity: 'RewardPool', id: '8453-0xpool' }),
            product({ entity: 'ClassicBoost', id: '8453-0xboost' }),
            product({ entity: 'LstVault', id: '8453-0xlst' }),
            product({ entity: 'Swapper', id: '8453-0xswap' }),
        ];
        const findings = diffCoverage(
            rows,
            indexed({
                Classic: ['8453-0xclassic'],
                Clm: ['8453-0xclm'],
                RewardPool: ['8453-0xpool'],
                ClassicBoost: ['8453-0xboost'],
                LstVault: ['8453-0xlst'],
                Swapper: ['8453-0xswap'],
            }),
            new Set(),
            20
        );
        expect(findings).toHaveLength(coverageEntities().length);
        expect(findings.every((item) => item.check.endsWith('.summary'))).toBe(true);
        expect(findings.every((item) => item.severity === 'info')).toBe(true);
    });
});

describe('probe scoping', () => {
    const ids = ['8453-0xaaa', '8453-0xbbb'];

    it('scopes contract probes on ids and ledger probes on chainId-token, both as parameters', () => {
        const contractProbe = structureProbes().find((probe) => probe.id === 'Contract.facts-partial');
        const ledgerProbe = sanityProbes().find((probe) => probe.id === 'Balance.negative');
        const chainProbe = structureProbes().find((probe) => probe.id === 'Contract.id-mismatch');
        if (!contractProbe || !ledgerProbe || !chainProbe) throw new Error('missing probe');
        expect(scopePredicate(contractProbe, ids).text).toBe('has({p_0:Array(String)}, toString(t.id))');
        expect(scopePredicate(ledgerProbe, ids)).toEqual(sql`has(${param('Array(String)', ids)}, ${tokenKey('t')})`);
        expect(probeWhere(ledgerProbe, [8453], ids).text).toBe(
            `has({p_0:Array(Int64)}, toInt64(\`t\`.chain_id)) AND ${scopePredicate(ledgerProbe, ids).text.replace('p_0', 'p_1')} AND (${ledgerProbe.where.text})`
        );
        const queries = probeQueries(contractProbe, [8453, 10], ids, 5);
        expect(R.values(queries.sample.params)).toEqual([[8453, 10], ids, 'PARTIAL', 5]);
        expect(queries.sample.text).toMatch(/LIMIT \{p_3:UInt32\}$/);
        // the (large) catalog is only sent to the probes that read it
        expect(R.values(probeQueries(chainProbe, [8453], ids, 5).count.params)).toEqual([[8453]]);
    });

    it('keeps hostile ids and values out of the SQL text', () => {
        const hostile = ["8453-0x'; DROP TABLE Contract; --", "8453-0x\\' OR 1=1", "') OR ('1'='1"];
        for (const probe of allProbes()) {
            const queries = probeQueries(probe, [8453], hostile, 5);
            for (const value of hostile) {
                expect(queries.count.text).not.toContain(value);
                expect(queries.sample.text).not.toContain(value);
            }
            // every value of the probe is a parameter: no quoted literal other than the '-' separator of tokenKey
            expect(queries.count.text.replaceAll("'-'", '')).not.toMatch(/'[^']*'/);
        }
    });
});

describe('probe catalog', () => {
    it('keeps probe ids unique and every probe on the aliased main table', () => {
        const ids = allProbes().map((probe) => probe.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const probe of allProbes()) {
            expect(probe.from.text).toMatch(/\bAS t\b/);
        }
    });

    it('checks every required registry link and share token kind', () => {
        for (const { kind, relation } of requiredLinks()) {
            const probe = structureProbes().find((item) => item.id === `${kind}.missing-${relation}`);
            expect(probe?.where.params).toEqual({ p_0: kind });
            expect(probe?.ctes?.[0]?.[1].text).toContain('toString(relation) = {p_0:String}');
            expect(probe?.ctes?.[0]?.[1].params).toEqual({ p_0: relation });
            expect(probe?.from.text).toContain('LEFT ANTI JOIN linked');
        }
        const shareProbe = structureProbes().find((probe) => probe.id === 'Token.missing-share-token');
        expect(shareProbe?.where.params).toEqual({ p_0: shareTokenKinds() });
        // the coverage kinds are all registry kinds
        for (const entity of coverageEntities()) {
            for (const kind of entityKinds(entity)) {
                expect(['VAULT', 'CLM_MANAGER', 'REWARD_POOL', 'BOOST', 'LST_VAULT', 'SWAPPER']).toContain(kind);
            }
        }
    });

    it('compares raw amounts as Int256 and orders changes on-chain, in named CTEs', () => {
        expect(int256(sql`t.balance`).text).toBe('toInt256OrZero(toString(t.balance))');
        const continuity = sanityProbes().find((probe) => probe.id === 'TimelineEvent.balance-discontinuity');
        if (!continuity) throw new Error('missing probe');
        expect(continuity.from.text).toBe('previous_after AS t');
        expect(continuity.where.text).toContain('ifNull');
        const continuitySql = probeQueries(continuity, [8453], [], 5).count.text;
        expect(continuitySql).toMatch(/^WITH `balance_steps` AS \(/);
        expect(continuitySql).toContain('`previous_after` AS (');
        expect(continuitySql).toContain('ORDER BY block_number, log_index');
        const drift = sanityProbes().find((probe) => probe.id === 'Balance.drift-from-last-change');
        expect(drift?.ctes?.map(([name]) => name)).toEqual(['balance_steps', 'last_change']);
        expect(drift?.ctes?.[1]?.[1].text).toContain('argMax(balance_after, (block_number, log_index))');
        // no sub-select left in a probe: every derived table is a named CTE
        for (const probe of allProbes()) {
            expect(`${probe.from.text} ${probe.where.text}`).not.toMatch(/\(\s*SELECT/i);
        }
    });
});
