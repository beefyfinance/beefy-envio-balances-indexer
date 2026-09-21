import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { IndexedEntity } from './catalog';
import {
    BEEFY_NETWORK_TO_CHAIN_ID,
    type CatalogProduct,
    loadActiveChainIds,
    loadConfiguredLstVaults,
    loadVaultBlacklist,
    productId,
} from './catalog';
import { arrayLengthMismatch, catalogIdsByEntity, diffCoverage, sqlStringIn, toScaled } from './checks';

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
        const blacklist = loadVaultBlacklist(blacklistSource);
        expect(blacklist.length).toBeGreaterThan(200);
        expect(blacklist).toEqual(
            expect.arrayContaining([{ chainId: 10, address: '0x07ae77025feaf04f915375bc5f02c07545160db8' }])
        );
    });
});

describe('integrity coverage diff', () => {
    const indexed = (entries: Partial<Record<IndexedEntity, string[]>>) => {
        const map = new Map<IndexedEntity, Set<string>>();
        for (const entity of ['Classic', 'Clm', 'RewardPool', 'ClassicBoost', 'LstVault'] as const) {
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
});

describe('catalog scope', () => {
    it('keeps only catalog ids in the SQL predicate', () => {
        const ids = catalogIdsByEntity([
            product({ entity: 'Clm', id: '4326-0x3808e89223f26ddbacbf3cf36f99e37e537fb3de' }),
        ]);
        expect(sqlStringIn('t.id', ids.get('Clm') ?? [])).toBe(
            "t.id IN ('4326-0x3808e89223f26ddbacbf3cf36f99e37e537fb3de')"
        );
        expect(sqlStringIn('t.id', ids.get('Classic') ?? [])).toBe('0');
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
});
