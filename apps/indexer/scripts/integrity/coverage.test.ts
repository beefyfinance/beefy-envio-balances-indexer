import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { addressBookByChainId } from '@beefyfinance/blockchain-addressbook';
import * as R from 'remeda';
import { describe, expect, it } from 'vitest';

import {
    ADDRESSBOOK_CONFIG_FACTORIES,
    BEEFY_NETWORK_TO_CHAIN_ID,
    type CatalogProduct,
    COVERAGE_ENTITIES,
    ENTITY_KINDS,
    type IndexedEntity,
    isConfiguredAddress,
    loadActiveChainIds,
    loadConfiguredContracts,
    loadConfiguredLstVaults,
    loadConfiguredSwappers,
    loadVaultBlacklist,
    productId,
} from './catalog';
import {
    ALL_PROBES,
    diffCoverage,
    int,
    probeWhere,
    REQUIRED_LINKS,
    SANITY_PROBES,
    SHARE_TOKEN_KINDS,
    STRUCTURE_PROBES,
    scopePredicate,
    tokenKey,
} from './checks';
import { sqlStringIn } from './clickhouse';

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
            expect(R.values(BEEFY_NETWORK_TO_CHAIN_ID)).toContain(chainId);
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
            for (const { contract, field } of ADDRESSBOOK_CONFIG_FACTORIES) {
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
        for (const entity of COVERAGE_ENTITIES) {
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
        expect(findings).toHaveLength(COVERAGE_ENTITIES.length);
        expect(findings.every((item) => item.check.endsWith('.summary'))).toBe(true);
        expect(findings.every((item) => item.severity === 'info')).toBe(true);
    });
});

describe('probe scoping', () => {
    const ids = ['8453-0xaaa', '8453-0xbbb'];

    it('scopes contract probes on ids and ledger probes on chainId-token', () => {
        const contractProbe = STRUCTURE_PROBES.find((probe) => probe.id === 'Contract.facts-partial');
        const ledgerProbe = SANITY_PROBES.find((probe) => probe.id === 'Balance.negative');
        if (!contractProbe || !ledgerProbe) throw new Error('missing probe');
        expect(scopePredicate(contractProbe, ids)).toBe("t.id IN ('8453-0xaaa','8453-0xbbb')");
        expect(scopePredicate(ledgerProbe, ids)).toBe(`${tokenKey('t')} IN ('8453-0xaaa','8453-0xbbb')`);
        expect(probeWhere(ledgerProbe, [8453, 10], [])).toBe(
            `t.chain_id IN (8453,10) AND 0 AND (${ledgerProbe.where})`
        );
    });

    it('rejects literals that would need escaping', () => {
        expect(sqlStringIn('t.id', [])).toBe('0');
        expect(() => sqlStringIn('t.id', ["8453-0x'; DROP"])).toThrow('Unexpected SQL literal');
    });
});

describe('probe catalog', () => {
    it('keeps probe ids unique and every probe on the aliased main table', () => {
        const ids = ALL_PROBES.map((probe) => probe.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const probe of ALL_PROBES) {
            expect(probe.from).toMatch(/\bAS t\b/);
        }
    });

    it('checks every required registry link and share token kind', () => {
        for (const { kind, relation } of REQUIRED_LINKS) {
            const probe = STRUCTURE_PROBES.find((item) => item.id === `${kind}.missing-${relation}`);
            expect(probe?.where).toContain(`relation = '${relation}'`);
        }
        const shareProbe = STRUCTURE_PROBES.find((probe) => probe.id === 'Token.missing-share-token');
        for (const kind of SHARE_TOKEN_KINDS) {
            expect(shareProbe?.where).toContain(`'${kind}'`);
        }
        // the coverage kinds are all registry kinds
        for (const kinds of R.values(ENTITY_KINDS)) {
            for (const kind of kinds) {
                expect(['VAULT', 'CLM_MANAGER', 'REWARD_POOL', 'BOOST', 'LST_VAULT', 'SWAPPER']).toContain(kind);
            }
        }
    });

    it('compares raw amounts as Int256 and orders changes on-chain', () => {
        expect(int('t.balance')).toBe('toInt256OrZero(toString(t.balance))');
        const continuity = SANITY_PROBES.find((probe) => probe.id === 'BalanceChange.discontinuity');
        expect(continuity?.from).toContain('ORDER BY block_number, log_index');
        expect(continuity?.where).toContain('ifNull');
        const drift = SANITY_PROBES.find((probe) => probe.id === 'Balance.drift-from-last-change');
        expect(drift?.from).toContain('argMax(balance_after, (c.block_number, c.log_index))');
    });
});
