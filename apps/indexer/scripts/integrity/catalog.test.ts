import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    configuredLstProducts,
    configuredSwapperProducts,
    fetchCatalog,
    isLiveStatus,
    loadActiveChainIds,
    loadConfiguredContracts,
    loadVaultBlacklist,
    productId,
} from './catalog.ts';

const SAMPLE_YAML = `
networks:
  - id: 8453
    contracts:
      - name: LstVault
        address:
          - 0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
          # - 0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
      - name: BeefySwapper
        address:
          - 0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
  # - id: 250
  #   contracts:
  #     - name: LstVault
  #       address:
  #         - 0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD
  - id: 42161
    contracts:
      - name: LstVault
        address: []
      - name: BeefySwapper
        address:
          - 0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE
`;

describe('catalog helpers', () => {
    it('normalizes product ids and live statuses', () => {
        expect(productId(8453, '0xAbCDef0000000000000000000000000000000001')).toBe(
            '8453-0xabcdef0000000000000000000000000000000001'
        );
        expect(isLiveStatus('active')).toBe(true);
        expect(isLiveStatus('PAUSED')).toBe(true);
        expect(isLiveStatus(undefined)).toBe(true);
        expect(isLiveStatus('eol')).toBe(false);
        expect(isLiveStatus('closed')).toBe(false);
    });

    it('parses uncommented chains and contract addresses from synthetic yaml', () => {
        expect(loadActiveChainIds(SAMPLE_YAML)).toEqual([8453, 42161]);
        expect(loadConfiguredContracts(SAMPLE_YAML, 'LstVault')).toEqual([
            { chainId: 8453, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        ]);
        expect(loadConfiguredContracts(SAMPLE_YAML, 'BeefySwapper')).toEqual([
            { chainId: 8453, address: '0xcccccccccccccccccccccccccccccccccccccccc' },
            { chainId: 42161, address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
        ]);
        expect(loadConfiguredContracts(SAMPLE_YAML, 'Missing')).toEqual([]);
    });

    it('filters configured products to the requested chains', () => {
        const lsts = configuredLstProducts(SAMPLE_YAML, [42161]);
        const swappers = configuredSwapperProducts(SAMPLE_YAML, [8453]);
        expect(lsts).toEqual([]);
        expect(swappers).toEqual([
            {
                entity: 'Swapper',
                id: '8453-0xcccccccccccccccccccccccccccccccccccccccc',
                chainId: 8453,
                address: '0xcccccccccccccccccccccccccccccccccccccccc',
                beefyId: 'config.yaml BeefySwapper',
                status: 'configured',
                live: true,
            },
        ]);
    });

    it('fails when the vault blacklist markers are missing', () => {
        expect(() => loadVaultBlacklist('export const somethingElse = []')).toThrow(
            'Could not locate rawVaultBlacklist'
        );
    });
});

describe('fetchCatalog', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const jsonResponse = (body: unknown) =>
        ({
            ok: true,
            json: async () => body,
        }) as Response;

    it('maps Beefy endpoints onto indexer entities and skips unknown networks', async () => {
        const vault = '0x1111111111111111111111111111111111111111';
        const cow = '0x2222222222222222222222222222222222222222';
        const gov = '0x3333333333333333333333333333333333333333';
        const boost = '0x4444444444444444444444444444444444444444';
        vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : input.toString();
            if (url.endsWith('/vaults')) {
                return jsonResponse([
                    { id: 'base-vault', chain: 'base', status: 'active', earnContractAddress: vault },
                    { id: 'ftm-vault', chain: 'fantom', status: 'active', earnContractAddress: vault },
                    { id: 'no-address', chain: 'base', status: 'active' },
                ]);
            }
            if (url.endsWith('/cow-vaults')) {
                return jsonResponse([{ id: 'base-clm', network: 'base', status: 'eol', earnContractAddress: cow }]);
            }
            if (url.endsWith('/gov-vaults')) {
                return jsonResponse([{ id: 'base-gov', chain: 'base', status: 'paused', earnContractAddress: gov }]);
            }
            if (url.endsWith('/boosts')) {
                return jsonResponse([
                    { id: 'base-boost', chain: 'base', status: 'active', earnContractAddress: boost },
                ]);
            }
            throw new Error(`unexpected url ${url}`);
        });

        const products = await fetchCatalog([8453], 'https://api.example');
        expect(products).toEqual([
            {
                entity: 'Classic',
                id: `8453-${vault}`,
                chainId: 8453,
                address: vault,
                beefyId: 'base-vault',
                status: 'active',
                live: true,
            },
            {
                entity: 'Clm',
                id: `8453-${cow}`,
                chainId: 8453,
                address: cow,
                beefyId: 'base-clm',
                status: 'eol',
                live: false,
            },
            {
                entity: 'RewardPool',
                id: `8453-${gov}`,
                chainId: 8453,
                address: gov,
                beefyId: 'base-gov',
                status: 'paused',
                live: true,
            },
            {
                entity: 'ClassicBoost',
                id: `8453-${boost}`,
                chainId: 8453,
                address: boost,
                beefyId: 'base-boost',
                status: 'active',
                live: true,
            },
        ]);
    });

    it('keeps the live row when the same product appears as both eol and active', async () => {
        const address = '0x5555555555555555555555555555555555555555';
        vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : input.toString();
            if (url.endsWith('/vaults')) {
                return jsonResponse([
                    { id: 'old', chain: 'base', status: 'eol', earnContractAddress: address },
                    { id: 'new', chain: 'base', status: 'active', earnContractAddress: address },
                ]);
            }
            return jsonResponse([]);
        });

        const products = await fetchCatalog([8453], 'https://api.example');
        expect(products).toEqual([
            expect.objectContaining({ entity: 'Classic', beefyId: 'new', live: true, status: 'active' }),
        ]);
    });

    it('drops malformed entries (logged) and never trusts hostile values', async () => {
        const vault = '0x1111111111111111111111111111111111111111';
        vi.stubGlobal('fetch', async (input: string | URL | Request) => {
            const url = input instanceof Request ? input.url : input.toString();
            if (url.endsWith('/vaults')) {
                return jsonResponse([
                    { id: 'ok', chain: 'base', status: 'active', earnContractAddress: vault },
                    {
                        id: 'sql',
                        chain: 'base',
                        status: 'active',
                        earnContractAddress: "0x1'; DROP TABLE Contract; --",
                    },
                    { id: 'proto', chain: '__proto__', status: 'active', earnContractAddress: vault },
                    { id: 'ctor', chain: 'constructor', status: 'active', earnContractAddress: vault },
                    { id: 42, chain: 'base', earnContractAddress: vault },
                    { id: 'strategy', chain: 'base', earnContractAddress: vault, strategy: { $ne: null } },
                    'not an object',
                    null,
                ]);
            }
            if (url.endsWith('/cow-vaults')) return jsonResponse({ not: 'a list' });
            return jsonResponse([]);
        });
        await expect(fetchCatalog([8453], 'https://api.example', () => undefined)).rejects.toThrow(
            'GET https://api.example/cow-vaults: expected a list'
        );

        vi.stubGlobal('fetch', async (input: string | URL | Request) => {
            const url = input instanceof Request ? input.url : input.toString();
            if (url.endsWith('/vaults')) {
                return jsonResponse([
                    { id: 'ok', chain: 'base', status: 'active', earnContractAddress: vault },
                    { id: 'sql', chain: 'base', earnContractAddress: "0x1'; DROP TABLE Contract; --" },
                    { id: 'proto', chain: '__proto__', earnContractAddress: vault },
                    { id: 42, chain: 'base', earnContractAddress: vault },
                    'not an object',
                ]);
            }
            return jsonResponse([]);
        });
        const messages: string[] = [];
        const products = await fetchCatalog([8453], 'https://api.example', (message) => messages.push(message));
        expect(products).toEqual([expect.objectContaining({ beefyId: 'ok', id: `8453-${vault}` })]);
        expect(messages).toEqual(['GET https://api.example/vaults: dropped 3 invalid entries']);
    });

    it('retries a failing catalog endpoint, then throws', async () => {
        const calls: string[] = [];
        vi.stubGlobal('fetch', async (input: string | URL | Request) => {
            calls.push(input instanceof Request ? input.url : input.toString());
            return { ok: false, status: 503, statusText: 'Unavailable' } as Response;
        });
        await expect(fetchCatalog([8453], 'https://api.example', undefined, { retryDelaysMs: [0, 0] })).rejects.toThrow(
            'GET https://api.example/vaults failed'
        );
        // three attempts before giving up
        expect(calls.filter((url) => url.endsWith('/vaults'))).toHaveLength(3);
    });

    it('recovers when a retry succeeds', async () => {
        let calls = 0;
        vi.stubGlobal('fetch', async () => {
            calls += 1;
            if (calls === 1) throw new TypeError('fetch failed');
            return jsonResponse([]);
        });
        await expect(
            fetchCatalog([8453], 'https://api.example', undefined, { retryDelaysMs: [0, 0] })
        ).resolves.toEqual([]);
    });
});
