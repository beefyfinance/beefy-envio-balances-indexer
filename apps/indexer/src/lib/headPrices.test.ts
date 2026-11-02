import { indexer } from 'envio';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiChainName, createHeadPriceCache, headPriceAt, setHeadPriceSource } from './headPrices';

const VAULT = '0x00000000000000000000000000000000000000Aa';
const CLM = '0x00000000000000000000000000000000000000Cc';
const OTHER = '0x00000000000000000000000000000000000000Dd';
const POOL = '0x00000000000000000000000000000000000000Ee';
const BOOST = '0x00000000000000000000000000000000000000Bb';

type Answers = Record<string, unknown>;

/** A `fetch` answering each path from `answers` (an Error answers with a failure); records the paths. */
const stubFetch = (answers: () => Answers) => {
    const calls: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
        const path = new URL(input instanceof Request ? input.url : input).pathname;
        calls.push(path);
        const answer = answers()[path];
        if (answer instanceof Error) throw answer;
        if (answer === undefined) return new Response('', { status: 500 });
        return new Response(JSON.stringify(answer), { status: 200 });
    }) as typeof globalThis.fetch;
    return { fetch, calls };
};

const PPFS = '1500000000000000000';

const vault = (fields: Record<string, unknown> = {}) => ({
    id: 'wbtc-vault',
    oracleId: 'WBTC',
    chain: 'arbitrum',
    pricePerFullShare: PPFS,
    tokenDecimals: 18,
    earnContractAddress: VAULT,
    ...fields,
});

const mappings: Answers = {
    '/vaults/all': [
        vault(),
        // the same oracle on another chain, with its own ppfs, in the scientific notation the API sometimes uses
        vault({
            id: 'usdc-vault',
            chain: 'base',
            pricePerFullShare: '2e+18',
            tokenDecimals: 6,
            earnContractAddress: OTHER,
        }),
        // no ppfs: CLMs and reward pools; the oracle id can differ from the id
        vault({
            id: 'uniswap-cow-arb-b-a',
            oracleId: 'uniswap-cow-arb-a',
            pricePerFullShare: undefined,
            earnContractAddress: CLM,
        }),
        vault({
            id: 'velo-pool',
            oracleId: 'BeVELO',
            chain: 'optimism',
            pricePerFullShare: undefined,
            earnContractAddress: POOL,
        }),
    ],
    '/boosts': [
        { poolId: 'wbtc-vault', chain: 'arbitrum', earnContractAddress: BOOST },
        // another chain's vault of that id is not this boost's
        { poolId: 'wbtc-vault', chain: 'optimism', earnContractAddress: OTHER },
    ],
};

describe('head price cache', () => {
    it('finds contracts by chain and address, adjusts by ppfs when there is one', async () => {
        let now = 1_000;
        const { fetch } = stubFetch(() => ({
            ...mappings,
            '/lps': { 'uniswap-cow-arb-a': 2.25, unrelated: 3 },
            '/prices': { WBTC: 3, BeVELO: 0.5, unrelated: 3 },
        }));
        const cache = createHeadPriceCache({ fetch, retryDelaysMs: [0, 0], now: () => now, onError: () => undefined });

        // no price before the first fetch
        expect(cache.get(42161, VAULT)).toBeUndefined();
        await cache.refreshMappings();
        now = 2_000;
        await cache.refreshPrices();

        expect(cache.get(42161, VAULT.toLowerCase())).toEqual({ price: 4.5, fetchedAt: 2_000, decimals: 18 });
        expect(cache.get(42161, CLM)).toEqual({ price: 2.25, fetchedAt: 2_000 });
        expect(cache.get(10, POOL)).toEqual({ price: 0.5, fetchedAt: 2_000 });
        // 3 * 2e18 * 1e-6: a 6 decimals want
        expect(cache.get(8453, OTHER)).toEqual({ price: 6e12, fetchedAt: 2_000, decimals: 18 });
        expect(cache.get(8453, VAULT)).toBeUndefined();
        expect(cache.get(42161, OTHER)).toBeUndefined();
    });

    // shares are minted in want units: 2 want tokens deposited at a ppfs of 1.5 are 2 / 1.5 whole shares
    it.each([6, 8, 12, 18, 24])('values a vault with a want of %i decimals through its ppfs', async (tokenDecimals) => {
        const { fetch } = stubFetch(() => ({
            '/vaults/all': [vault({ tokenDecimals })],
            '/boosts': [{ poolId: 'wbtc-vault', chain: 'arbitrum', earnContractAddress: BOOST }],
            '/lps': {},
            '/prices': { WBTC: 3 },
        }));
        const cache = createHeadPriceCache({
            fetch,
            retryDelaysMs: [0, 0],
            now: () => 1_000,
            onError: () => undefined,
        });
        await cache.refreshMappings();
        await cache.refreshPrices();

        const head = cache.get(42161, VAULT);
        expect(head).toEqual({ price: 4.5 * 10 ** (18 - tokenDecimals), fetchedAt: 1_000, decimals: 18 });
        expect(cache.get(42161, BOOST)).toEqual(head);

        // what the API view computes: raw shares / 10^headDecimals * headPrice
        const rawShares = (2 / 1.5) * 10 ** tokenDecimals;
        const usd = (rawShares / 10 ** (head?.decimals ?? Number.NaN)) * (head?.price ?? Number.NaN);
        expect(usd).toBeCloseTo(2 * 3, 6);
    });

    it.each([6, 8, 18])(
        'keeps the oracle price of an entry without ppfs, on a %i decimals token',
        async (tokenDecimals) => {
            const { fetch } = stubFetch(() => ({
                '/vaults/all': [vault({ pricePerFullShare: undefined, tokenDecimals })],
                '/boosts': [],
                '/lps': {},
                '/prices': { WBTC: 3 },
            }));
            const cache = createHeadPriceCache({
                fetch,
                retryDelaysMs: [0, 0],
                now: () => 1_000,
                onError: () => undefined,
            });
            await cache.refreshMappings();
            await cache.refreshPrices();

            // no decimals: the row keeps the contract's priceDecimals
            expect(cache.get(42161, VAULT)).toEqual({ price: 3, fetchedAt: 1_000 });
        }
    );

    it('finds a boost through the vault of its poolId', async () => {
        const { fetch } = stubFetch(() => ({ ...mappings, '/lps': {}, '/prices': { WBTC: 3 } }));
        const cache = createHeadPriceCache({
            fetch,
            retryDelaysMs: [0, 0],
            now: () => 1_000,
            onError: () => undefined,
        });
        await cache.refreshMappings();
        await cache.refreshPrices();

        expect(cache.get(42161, BOOST)).toEqual({ price: 4.5, fetchedAt: 1_000, decimals: 18 });
        expect(cache.get(10, OTHER)).toBeUndefined();
    });

    it('finds a vault whose oracle is in /lps, and does not price a vault with a ppfs of 0', async () => {
        const { fetch } = stubFetch(() => ({
            '/vaults/all': [
                vault({ oracleId: 'lp' }),
                vault({ id: 'empty', oracleId: 'lp', pricePerFullShare: '0', earnContractAddress: OTHER }),
            ],
            '/boosts': [],
            '/lps': { lp: 2 },
            '/prices': {},
        }));
        const cache = createHeadPriceCache({
            fetch,
            retryDelaysMs: [0, 0],
            now: () => 1_000,
            onError: () => undefined,
        });
        await cache.refreshMappings();
        await cache.refreshPrices();

        expect(cache.get(42161, VAULT)).toEqual({ price: 3, fetchedAt: 1_000, decimals: 18 });
        expect(cache.get(42161, OTHER)).toBeUndefined();
    });

    it('keeps the previous prices and mappings when a fetch fails', async () => {
        let now = 1_000;
        let answers: Answers = { ...mappings, '/lps': {}, '/prices': { WBTC: 1 } };
        const { fetch } = stubFetch(() => answers);
        const errors: string[] = [];
        const cache = createHeadPriceCache({
            fetch,
            retryDelaysMs: [0, 0],
            now: () => now,
            onError: (message) => errors.push(message),
        });
        await cache.refreshMappings();
        await cache.refreshPrices();

        now = 61_000;
        answers = { '/prices': new Error('down'), '/lps': { 'uniswap-cow-arb-a': 4 } };
        await cache.refreshMappings();
        await cache.refreshPrices();

        // the vault keeps its price and its fetch time; the CLM gets the new one
        expect(cache.get(42161, VAULT)).toEqual({ price: 1.5, fetchedAt: 1_000, decimals: 18 });
        expect(cache.get(42161, CLM)).toEqual({ price: 4, fetchedAt: 61_000 });
        expect(errors).toHaveLength(3);
    });

    it('drops invalid API entries (logged) and keeps the previous data on an answer of the wrong shape', async () => {
        const errors: string[] = [];
        let answers: Answers = {
            '/vaults/all': [
                vault(),
                vault({ oracleId: 'uniswap-cow-arb-a', pricePerFullShare: undefined, earnContractAddress: CLM }),
                vault({ earnContractAddress: "0x1'; DROP TABLE x; --" }),
                vault({ earnContractAddress: undefined }),
                vault({ chain: 42161, earnContractAddress: OTHER }),
                vault({ pricePerFullShare: 'lots', earnContractAddress: OTHER }),
                vault({ pricePerFullShare: '-1', earnContractAddress: OTHER }),
                vault({ tokenDecimals: undefined, earnContractAddress: OTHER }),
                'not an object',
                null,
            ],
            '/boosts': [
                { poolId: 'wbtc-vault', chain: 'arbitrum', earnContractAddress: BOOST },
                { poolId: { $gt: '' }, chain: 'arbitrum', earnContractAddress: OTHER },
            ],
            '/lps': { 'uniswap-cow-arb-a': 2.25, broken: { price: 1 } },
            // Object.fromEntries defines `__proto__` as an own key (as JSON.parse does with a hostile answer), where an
            // object literal or an assignment would set the prototype instead
            /* oxlint-disable beefy/prefer-remeda-object */
            '/prices': Object.fromEntries([
                ['WBTC', 1],
                ['String', '2'],
                ['Negative', -1],
                ['Zero', 0],
                ['Null', null],
                ['__proto__', 3],
            ]),
            /* oxlint-enable beefy/prefer-remeda-object */
        };
        const { fetch } = stubFetch(() => answers);
        const cache = createHeadPriceCache({
            fetch,
            retryDelaysMs: [0, 0],
            now: () => 1_000,
            onError: (message) => errors.push(message),
        });
        await cache.refreshMappings();
        await cache.refreshPrices();

        expect(cache.get(42161, VAULT)).toEqual({ price: 1.5, fetchedAt: 1_000, decimals: 18 });
        expect(cache.get(42161, CLM)).toEqual({ price: 2.25, fetchedAt: 1_000 });
        expect(cache.get(42161, OTHER)).toBeUndefined();
        expect(errors).toEqual([
            'head prices: /vaults/all: dropped 8 invalid entries',
            'head prices: /boosts: dropped 1 invalid entries',
            'head prices: /lps: dropped 1 invalid entries',
            'head prices: /prices: dropped 2 invalid entries',
        ]);
        // nothing leaked onto Object.prototype
        expect(({} as Record<string, unknown>).WBTC).toBeUndefined();

        // whole answers of the wrong shape: failed fetches, the previous data stays
        errors.length = 0;
        answers = {
            '/vaults/all': { not: 'a list' },
            '/boosts': [],
            '/lps': 'cheap',
            '/prices': [1, 2],
        };
        await cache.refreshMappings();
        await cache.refreshPrices();
        expect(cache.get(42161, VAULT)).toEqual({ price: 1.5, fetchedAt: 1_000, decimals: 18 });
        expect(cache.get(42161, CLM)).toEqual({ price: 2.25, fetchedAt: 1_000 });
        expect(errors).toEqual([
            'head prices: /vaults/all: unexpected answer (not a list)',
            'head prices: /lps: unexpected answer (not an object)',
            'head prices: /prices: unexpected answer (not an object)',
        ]);
    });

    it('refreshes prices every minute and mappings every 10 minutes', async () => {
        const { fetch, calls } = stubFetch(() => mappings);
        // no retries: every price answer here fails, and the count is of refreshes
        const cache = createHeadPriceCache({ fetch, retryDelaysMs: [], onError: () => undefined });
        vi.useFakeTimers();
        try {
            cache.start();
            await vi.advanceTimersByTimeAsync(10 * 60_000);
            cache.stop();
        } finally {
            vi.useRealTimers();
        }
        const count = (path: string) => calls.filter((call) => call === path).length;
        // the first fetch, then one per period
        expect(count('/prices')).toBe(11);
        expect(count('/vaults/all')).toBe(2);
    });

    it('asks for the mappings again with the next prices when the first fetch failed', async () => {
        const { fetch, calls } = stubFetch(() => ({}));
        const cache = createHeadPriceCache({ fetch, retryDelaysMs: [], onError: () => undefined });
        vi.useFakeTimers();
        try {
            cache.start();
            await vi.advanceTimersByTimeAsync(60_000);
            cache.stop();
        } finally {
            vi.useRealTimers();
        }
        expect(calls.filter((call) => call === '/vaults/all')).toHaveLength(2);
    });

    it('names every configured chain as the Beefy API does', () => {
        expect(apiChainName(42161)).toBe('arbitrum');
        expect(apiChainName(43114)).toBe('avax');
        expect(apiChainName(4326)).toBe('megaeth');
        expect(indexer.chainIds.filter((chainId) => apiChainName(chainId) === undefined)).toEqual([]);
    });
});

describe('head price age rules', () => {
    const BLOCK_TS = 1_700_000_000;
    const at = (secondsAfterBlock: number) => (BLOCK_TS + secondsAfterBlock) * 1000;
    const usePrice = (fetchedAt: number, now: number) =>
        setHeadPriceSource({ get: () => ({ price: 1, fetchedAt }) }, () => now);

    afterEach(() => setHeadPriceSource(undefined));

    it('prices an event at most 10 minutes old with a price at most 15 minutes old', () => {
        usePrice(at(0), at(600));
        expect(headPriceAt(42161, VAULT, BLOCK_TS)).toEqual({ price: 1, fetchedAt: at(0) });
        usePrice(at(0), at(601));
        expect(headPriceAt(42161, VAULT, BLOCK_TS)).toBeUndefined();
        usePrice(at(300) - 15 * 60_000, at(300));
        expect(headPriceAt(42161, VAULT, BLOCK_TS)).toEqual({ price: 1, fetchedAt: at(300) - 15 * 60_000 });
        usePrice(at(300) - 15 * 60_000 - 1, at(300));
        expect(headPriceAt(42161, VAULT, BLOCK_TS)).toBeUndefined();
    });

    it('is disabled in RPC fixture mode', () => {
        expect(headPriceAt(42161, VAULT, Math.floor(Date.now() / 1000))).toBeUndefined();
    });
});
