import { indexer } from 'envio';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiChainName, createHeadPriceCache, headPriceAt, setHeadPriceSource } from './headPrices';

const VAULT = '0x00000000000000000000000000000000000000Aa';
const CLM = '0x00000000000000000000000000000000000000Cc';
const OTHER = '0x00000000000000000000000000000000000000Dd';

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

const mappings: Answers = {
    '/vaults': [
        { chain: 'arbitrum', earnedToken: 'mooArbA', earnContractAddress: VAULT },
        { chain: 'base', earnedToken: 'mooArbA', earnContractAddress: OTHER },
    ],
    '/cow-vaults': [{ id: 'uniswap-cow-arb-a', chain: 'arbitrum', earnContractAddress: CLM }],
};

describe('head price cache', () => {
    it('maps moo token and CLM prices to product addresses, per chain', async () => {
        let now = 1_000;
        const { fetch } = stubFetch(() => ({
            ...mappings,
            '/mootokenprices': { arbitrum: { mooArbA: 1.5 }, base: { mooArbA: 7 } },
            '/lps': { 'uniswap-cow-arb-a': 2.25, unrelated: 3 },
        }));
        const cache = createHeadPriceCache({ fetch, retryDelaysMs: [0, 0], now: () => now, onError: () => undefined });

        // no price before the first fetch
        expect(cache.get(42161, VAULT)).toBeUndefined();
        await cache.refreshMappings();
        now = 2_000;
        await cache.refreshPrices();

        expect(cache.get(42161, VAULT.toLowerCase())).toEqual({ price: 1.5, fetchedAt: 2_000 });
        expect(cache.get(42161, CLM)).toEqual({ price: 2.25, fetchedAt: 2_000 });
        // the same symbol on another chain is another product
        expect(cache.get(8453, OTHER)).toEqual({ price: 7, fetchedAt: 2_000 });
        expect(cache.get(8453, VAULT)).toBeUndefined();
        expect(cache.get(42161, OTHER)).toBeUndefined();
    });

    it('keeps the previous prices and mappings when a fetch fails', async () => {
        let now = 1_000;
        let answers: Answers = { ...mappings, '/mootokenprices': { arbitrum: { mooArbA: 1.5 } }, '/lps': {} };
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
        answers = { '/mootokenprices': new Error('down'), '/lps': { 'uniswap-cow-arb-a': 4 } };
        await cache.refreshMappings();
        await cache.refreshPrices();

        // the vault keeps its price and its fetch time; the CLM gets the new one
        expect(cache.get(42161, VAULT)).toEqual({ price: 1.5, fetchedAt: 1_000 });
        expect(cache.get(42161, CLM)).toEqual({ price: 4, fetchedAt: 61_000 });
        expect(errors).toHaveLength(3);
    });

    it('drops invalid API entries (logged) and keeps the previous data on an answer of the wrong shape', async () => {
        const errors: string[] = [];
        let answers: Answers = {
            '/vaults': [
                { chain: 'arbitrum', earnedToken: 'mooArbA', earnContractAddress: VAULT },
                { chain: 'arbitrum', earnedToken: 'mooEvil', earnContractAddress: "0x1'; DROP TABLE x; --" },
                { chain: 'arbitrum', earnedToken: 'mooNoAddress' },
                { chain: 42161, earnedToken: 'mooNumberChain', earnContractAddress: OTHER },
                'not an object',
                null,
            ],
            '/cow-vaults': [
                { id: 'uniswap-cow-arb-a', chain: 'arbitrum', earnContractAddress: CLM },
                { id: { $gt: '' }, chain: 'arbitrum', earnContractAddress: OTHER },
            ],
            // Object.fromEntries defines `__proto__` as an own key (as JSON.parse does with a hostile answer), where an
            // object literal or an assignment would set the prototype instead
            /* oxlint-disable beefy/prefer-remeda-object */
            '/mootokenprices': Object.fromEntries([
                [
                    'arbitrum',
                    Object.fromEntries([
                        ['mooArbA', 1.5],
                        ['mooString', '2'],
                        ['mooNegative', -1],
                        ['mooZero', 0],
                        ['mooNull', null],
                        ['__proto__', 3],
                    ]),
                ],
                ['base', 'not an object'],
                ['__proto__', { mooArbA: 99 }],
            ]),
            /* oxlint-enable beefy/prefer-remeda-object */
            '/lps': { 'uniswap-cow-arb-a': 2.25, broken: { price: 1 } },
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

        expect(cache.get(42161, VAULT)).toEqual({ price: 1.5, fetchedAt: 1_000 });
        expect(cache.get(42161, CLM)).toEqual({ price: 2.25, fetchedAt: 1_000 });
        expect(cache.get(42161, OTHER)).toBeUndefined();
        expect(errors).toEqual([
            'head prices: /vaults: dropped 5 invalid entries',
            'head prices: /cow-vaults: dropped 1 invalid entries',
            'head prices: /mootokenprices arbitrum: dropped 2 invalid entries',
            'head prices: /mootokenprices base: unexpected answer (not an object)',
            'head prices: /lps: dropped 1 invalid entries',
        ]);
        // nothing leaked onto Object.prototype
        expect(({} as Record<string, unknown>).mooArbA).toBeUndefined();

        // whole answers of the wrong shape: failed fetches, the previous data stays
        errors.length = 0;
        answers = { '/vaults': { not: 'a list' }, '/cow-vaults': [], '/mootokenprices': [1, 2], '/lps': 'cheap' };
        await cache.refreshMappings();
        await cache.refreshPrices();
        expect(cache.get(42161, VAULT)).toEqual({ price: 1.5, fetchedAt: 1_000 });
        expect(cache.get(42161, CLM)).toBeUndefined();
        expect(errors).toEqual([
            'head prices: /vaults: unexpected answer (not a list)',
            'head prices: /mootokenprices: unexpected answer (not an object)',
            'head prices: /lps: unexpected answer (not an object)',
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
        expect(count('/mootokenprices')).toBe(11);
        expect(count('/vaults')).toBe(2);
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
        expect(calls.filter((call) => call === '/vaults')).toHaveLength(2);
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
