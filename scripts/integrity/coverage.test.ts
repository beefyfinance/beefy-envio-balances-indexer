import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    BEEFY_NETWORK_TO_CHAIN_ID,
    type CatalogProduct,
    COVERAGE_ENTITIES,
    type IndexedEntity,
    loadActiveChainIds,
    loadConfiguredContracts,
    loadConfiguredLstVaults,
    loadConfiguredSwappers,
    loadVaultBlacklist,
    productId,
} from './catalog';
import {
    arrayLengthMismatch,
    catalogIdsByEntity,
    catalogScope,
    changeBlockSeq,
    clmAmountIdentitySql,
    diffCoverage,
    EVENT_PROBES,
    GRAPH_PROBES,
    lengthMismatchSql,
    rewardPoolListedSql,
    SANITY_PROBES,
    sqlStringIn,
    toScaled,
} from './checks';

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
            expect(Object.values(BEEFY_NETWORK_TO_CHAIN_ID)).toContain(chainId);
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
        expect(swappers).not.toEqual(
            expect.arrayContaining([{ chainId: 80094, address: '0xbc4a342b0c057501e081484a2d24e576e854f823' }])
        );
        expect(loadConfiguredContracts(configYaml, 'BeefySwapper')).toEqual(swappers);
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

        const byCheck = Object.fromEntries(findings.map((item) => [item.check, item]));
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
        const byCheck = Object.fromEntries(findings.map((item) => [item.check, item]));
        expect(byCheck['Swapper.missing-configured']).toMatchObject({ severity: 'warning', count: 1 });
        expect(byCheck['Swapper.missing-active']).toBeUndefined();
        expect(byCheck['Swapper.extra']).toBeUndefined();
        expect(byCheck['Swapper.summary']?.sample[0]).toContain('extra=1');
    });
});

describe('catalog scope', () => {
    it('keeps only catalog ids in the SQL predicate', () => {
        const ids = catalogIdsByEntity([
            product({ entity: 'Clm', id: '4326-0x3808e89223f26ddbacbf3cf36f99e37e537fb3de' }),
            product({ entity: 'Swapper', id: '8453-0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc' }),
        ]);
        expect(sqlStringIn('t.id', ids.get('Clm') ?? [])).toBe(
            "t.id IN ('4326-0x3808e89223f26ddbacbf3cf36f99e37e537fb3de')"
        );
        expect(sqlStringIn('t.id', ids.get('Classic') ?? [])).toBe('0');
        expect(sqlStringIn('t.id', ids.get('Swapper') ?? [])).toBe(
            "t.id IN ('8453-0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc')"
        );
    });

    it('maps child tables onto catalog parent id columns', () => {
        expect(catalogScope('ClassicVaultStrategy AS t')).toEqual({
            entity: 'Classic',
            column: 't.classic_vault_id',
        });
        expect(catalogScope('ClmStrategy AS t')).toEqual({ entity: 'Clm', column: 't.clm_manager_id' });
        expect(catalogScope('ClassicHarvestEvent AS t INNER JOIN Classic AS c ON c.id = t.classic_id')).toEqual({
            entity: 'Classic',
            column: 't.classic_id',
        });
        expect(catalogScope('ClmPositionInteraction AS t')).toEqual({ entity: 'Clm', column: 't.clm_id' });
        expect(catalogScope('SwapperRoute AS t')).toEqual({ entity: 'Swapper', column: 't.swapper_id' });
        expect(catalogScope('ClassicPosition AS p INNER JOIN Classic AS c ON c.id = p.classic_id')).toEqual({
            entity: 'Classic',
            column: 'p.classic_id',
        });
    });
});

describe('integrity numeric helpers', () => {
    it('scales decimals and detects parallel array mismatches', () => {
        expect(toScaled('1.5')).toBe(1500000000000000000000000n);
        expect(toScaled('0.000000000000000000000000')).toBe(0n);
        expect(toScaled('-2')).toBe(-2000000000000000000000000n);
        expect(
            arrayLengthMismatch(
                {
                    rewardPoolToken_ids: ['a'],
                    rewardPoolTokensOrder: ['a', 'b'],
                    rewardPoolsTotalSupply: ['1'],
                },
                [['rewardPoolToken_ids', 'rewardPoolTokensOrder', 'rewardPoolsTotalSupply']]
            )
        ).toEqual(['rewardPoolToken_ids=1 rewardPoolTokensOrder=2 rewardPoolsTotalSupply=1']);
    });

    it('ranks token balance changes by numeric block number', () => {
        expect(changeBlockSeq()).toBe('(toUInt64(t.block_number), t.trx_index, t.log_index)');
    });
});

describe('clm amount identity', () => {
    it('reconstructs balances() from idle, main, alt, locked profit, and unharvested fees', () => {
        const amount0 = SANITY_PROBES.find((probe) => probe.id === 'clm.amount0-identity');
        const amount1 = SANITY_PROBES.find((probe) => probe.id === 'clm.amount1-identity');
        expect(amount0?.where).toBe(`t.initializable_status = 'INITIALIZED' AND ${clmAmountIdentitySql('0')}`);
        expect(amount1?.where).toBe(`t.initializable_status = 'INITIALIZED' AND ${clmAmountIdentitySql('1')}`);
        expect(clmAmountIdentitySql('0')).toContain('underlying_idle_amount0');
        expect(clmAmountIdentitySql('0')).toContain('underlying_locked_amount0');
        expect(clmAmountIdentitySql('0')).toContain('underlying_unharvested_fees0');
        expect(clmAmountIdentitySql('0')).not.toContain('underlying_pool_amount0');
    });
});

describe('graph and event helper SQL', () => {
    it('builds length-mismatch and reward-pool has() predicates', () => {
        expect(
            lengthMismatchSql([['reward_pool_token_ids', 'reward_pool_tokens_order', 'reward_pools_total_supply']])
        ).toBe(
            'length(t.reward_pool_token_ids) != length(t.reward_pool_tokens_order) OR length(t.reward_pool_token_ids) != length(t.reward_pools_total_supply)'
        );
        expect(rewardPoolListedSql('c')).toBe('NOT has(c.reward_pool_token_ids, t.share_token_id)');
        expect(GRAPH_PROBES.find((probe) => probe.id === 'rewardPool.classic-not-listed')?.where).toContain(
            'NOT has(c.reward_pool_token_ids, t.share_token_id)'
        );
        expect(EVENT_PROBES.map((probe) => probe.id)).toEqual(
            expect.arrayContaining([
                'classicHarvest.missing-classic',
                'classicHarvest.array-alignment',
                'clmInteraction.total-balance',
            ])
        );
    });
});
