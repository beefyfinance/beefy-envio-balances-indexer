/**
 * Indexer prices (docs/timeline-redesign.md "Indexer prices"): the latest Beefy API share price of each product, kept
 * in memory per chain and read synchronously by the timeline writers.
 *
 * - Classic vaults: `/mootokenprices` (API chain -> moo token symbol -> price), mapped to addresses by `/vaults`
 *   (`earnedToken` -> `earnContractAddress`). CLM managers: `/lps` (vault id -> price), mapped by `/cow-vaults`
 *   (`id` -> `earnContractAddress`).
 * - Prices are refreshed every minute and the address mappings every 10 minutes (HEAD_PRICE_REFRESH_MS,
 *   HEAD_PRICE_MAPPINGS_REFRESH_MS), in the background; a failed fetch keeps the previous data. Each price carries the
 *   time its endpoint was fetched (`fetchedAt`).
 * - Answers are validated (zod): invalid entries are dropped and logged, an answer of the wrong shape is a failed fetch.
 * - Handlers never wait for the API: a handler that runs before the first fetch completes finds no price.
 * - Not an Envio effect: effects cache by input, and this value depends on when it is read.
 * - Disabled in RPC fixture mode (unit tests), so test runs stay deterministic; tests inject a cache and a clock.
 */
/* oxlint-disable beefy/no-wall-clock -- a head price is the price now: its age is measured against the wall clock */

import { ChainId } from '@beefyfinance/blockchain-addressbook';
import * as R from 'remeda';
import { z } from 'zod';

import { indexerConfig } from './config';
import { describeError } from './errors';
import { fetchWithRetry, type RetryOptions } from './fetch';
import { asHex } from './hex';

export type HeadPrice = { price: number; fetchedAt: number };

/** Product address (lowercase) -> latest price, per chain id. */
export type HeadPriceSource = { get: (chainId: number, product: string) => HeadPrice | undefined };

/** Beefy API chain name of a chain id (the addressbook names are the API's: checked against `/vaults`). */
export const apiChainName = (chainId: number): string | undefined => (ChainId as Record<number, string>)[chainId];

// API answers are never trusted: each entry is validated alone and an invalid one is dropped (and counted in a log
// line); an answer whose shape is wrong as a whole counts as a failed fetch (the previous data is kept).

const addressSchema = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform(asHex);
const apiVaultSchema = z.object({
    chain: z.string().min(1),
    earnedToken: z.string().min(1),
    earnContractAddress: addressSchema,
});
const apiCowVaultSchema = z.object({
    id: z.string().min(1),
    chain: z.string().min(1),
    earnContractAddress: addressSchema,
});
/** A listed price: null and 0 are the API's "no price" (valid, not priced); anything else must be a positive number. */
const listedPriceSchema = z.number().nonnegative().nullable();
const jsonObjectSchema = z.custom<Record<string, unknown>>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
);

/** Prices by key (moo token symbol, or CLM vault id); only positive prices are kept. */
type Prices = ReadonlyMap<string, number>;
type Fetched<T> = { data: T; fetchedAt: number };

/** The product's address and the key its price is listed under. */
type Mapping = { chain: string; key: string; address: string };

export type HeadPriceCache = HeadPriceSource & {
    refreshPrices: () => Promise<void>;
    refreshMappings: () => Promise<void>;
    /** First fetch (mappings, then prices) and the refresh timers; the timers do not keep the process alive. */
    start: () => void;
    stop: () => void;
};

export const createHeadPriceCache = ({
    fetch = globalThis.fetch,
    now = Date.now,
    baseUrl = indexerConfig().beefyApiUrl,
    pricesRefreshMs = indexerConfig().headPrices.pricesRefreshMs,
    mappingsRefreshMs = indexerConfig().headPrices.mappingsRefreshMs,
    // the refreshes run on timers, outside any handler: there is no `context.log` to write to
    // oxlint-disable-next-line no-console
    onError = (message: string) => console.warn(message),
    retryDelaysMs,
}: {
    fetch?: typeof globalThis.fetch;
    /** Between the attempts of one request (see {@link fetchWithRetry}). */
    retryDelaysMs?: RetryOptions['retryDelaysMs'];
    now?: () => number;
    baseUrl?: string;
    pricesRefreshMs?: number;
    mappingsRefreshMs?: number;
    onError?: (message: string) => void;
} = {}): HeadPriceCache => {
    let vaults: Mapping[] = [];
    let cowVaults: Mapping[] = [];
    /** API chain -> moo token symbol -> price */
    let mooPrices: Fetched<ReadonlyMap<string, Prices>> | undefined;
    /** CLM vault id -> price */
    let lpPrices: Fetched<Prices> | undefined;
    let byChain = new Map<string, Map<string, HeadPrice>>();
    let timers: ReturnType<typeof setInterval>[] = [];

    /** The answer's JSON, undefined (and logged) on any failure, so the caller keeps its previous data. */
    const fetchJson = async (path: string): Promise<Fetched<unknown> | undefined> => {
        try {
            const response = await fetchWithRetry(new URL(path, `${baseUrl}/`), {}, { fetch, retryDelaysMs });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return { data: await response.json(), fetchedAt: now() };
        } catch (error) {
            onError(`head prices: ${path} failed (${describeError(error)})`);
            return undefined;
        }
    };

    /** The valid items of `entries` (null when the answer is not of the expected shape: a failed fetch). */
    const validated = <T>(path: string, entries: readonly unknown[], schema: z.ZodType<T>): T[] => {
        const results = R.map(entries, (entry) => schema.safeParse(entry));
        const valid = R.pipe(
            results,
            R.filter((result) => result.success),
            R.map((result) => result.data)
        );
        if (valid.length < results.length) {
            onError(`head prices: ${path}: dropped ${results.length - valid.length} invalid entries`);
        }
        return valid;
    };

    /** A JSON object -> its entries, or undefined (logged) when it is not one. */
    const objectEntries = (path: string, data: unknown): [string, unknown][] | undefined => {
        const parsed = jsonObjectSchema.safeParse(data);
        if (!parsed.success) {
            onError(`head prices: ${path}: unexpected answer (not an object)`);
            return undefined;
        }
        return R.entries(parsed.data);
    };

    /** `{ key: price }` -> the positive prices; invalid entries dropped (logged). */
    const parsePrices = (path: string, data: unknown): Prices | undefined => {
        const entries = objectEntries(path, data);
        if (entries === undefined) return undefined;
        const prices = validated(path, entries, z.tuple([z.string(), listedPriceSchema]));
        return new Map(R.filter(prices, (entry): entry is [string, number] => entry[1] !== null && entry[1] > 0));
    };

    const parseMooPrices = (data: unknown): ReadonlyMap<string, Prices> | undefined => {
        const chains = objectEntries('/mootokenprices', data);
        if (chains === undefined) return undefined;
        return new Map(
            R.pipe(
                chains,
                R.map(([chain, prices]) => [chain, parsePrices(`/mootokenprices ${chain}`, prices)] as const),
                R.filter((entry): entry is readonly [string, Prices] => entry[1] !== undefined)
            )
        );
    };

    const parseList = <T>(path: string, data: unknown, schema: z.ZodType<T>): T[] | undefined => {
        if (!Array.isArray(data)) {
            onError(`head prices: ${path}: unexpected answer (not a list)`);
            return undefined;
        }
        return validated(path, data, schema);
    };

    /** The priced mappings of one endpoint; none before its first successful fetch. */
    const priced = <T>(
        mappings: Mapping[],
        fetched: Fetched<T> | undefined,
        priceOf: (data: T, mapping: Mapping) => number | undefined
    ) =>
        fetched === undefined
            ? []
            : R.flatMap(mappings, (mapping) => {
                  const price = priceOf(fetched.data, mapping);
                  return price === undefined ? [] : [{ ...mapping, head: { price, fetchedAt: fetched.fetchedAt } }];
              });

    const rebuild = () => {
        byChain = R.pipe(
            [
                ...priced(vaults, mooPrices, (data, { chain, key }) => data.get(chain)?.get(key)),
                ...priced(cowVaults, lpPrices, (data, { key }) => data.get(key)),
            ],
            R.groupBy(({ chain }) => chain),
            R.mapValues((group) => new Map(R.map(group, ({ address, head }) => [address, head] as const))),
            R.entries(),
            (pairs) => new Map(pairs)
        );
    };

    /** Replaces `previous` with the parsed answer, keeps it when the fetch or the parse failed. */
    const refreshed = <T>(
        previous: Fetched<T> | undefined,
        fetched: Fetched<unknown> | undefined,
        parse: (data: unknown) => T | undefined
    ): Fetched<T> | undefined => {
        const data = fetched === undefined ? undefined : parse(fetched.data);
        return fetched === undefined || data === undefined ? previous : { data, fetchedAt: fetched.fetchedAt };
    };

    const refreshPrices = async () => {
        const [moo, lps] = await Promise.all([fetchJson('mootokenprices'), fetchJson('lps')]);
        mooPrices = refreshed(mooPrices, moo, parseMooPrices);
        lpPrices = refreshed(lpPrices, lps, (data) => parsePrices('/lps', data));
        rebuild();
    };

    const refreshMappings = async () => {
        const [vaultList, cowList] = await Promise.all([fetchJson('vaults'), fetchJson('cow-vaults')]);
        const vaultRows = vaultList && parseList('/vaults', vaultList.data, apiVaultSchema);
        if (vaultRows) {
            vaults = R.map(vaultRows, ({ chain, earnedToken, earnContractAddress }) => ({
                chain,
                key: earnedToken,
                address: earnContractAddress,
            }));
        }
        const cowRows = cowList && parseList('/cow-vaults', cowList.data, apiCowVaultSchema);
        if (cowRows) {
            cowVaults = R.map(cowRows, ({ chain, id, earnContractAddress }) => ({
                chain,
                key: id,
                address: earnContractAddress,
            }));
        }
        rebuild();
    };

    const start = () => {
        if (timers.length > 0) return;
        void refreshMappings().then(refreshPrices);
        timers = [
            setInterval(() => void refreshPrices(), pricesRefreshMs),
            setInterval(() => void refreshMappings(), mappingsRefreshMs),
        ];
        timers.forEach((timer) => timer.unref());
    };

    const stop = () => {
        timers.forEach((timer) => clearInterval(timer));
        timers = [];
    };

    const get = (chainId: number, product: string) => {
        const chain = apiChainName(chainId);
        return chain === undefined ? undefined : byChain.get(chain)?.get(asHex(product));
    };

    return { get, refreshPrices, refreshMappings, start, stop };
};

const disabled: HeadPriceSource = { get: () => undefined };

let source: HeadPriceSource | undefined;

/**
 * Test override, on `globalThis`: Envio's test indexer loads the handlers outside vitest's module graph, so a module
 * variable set by a test would not be the handlers' one.
 */
type Override = { source: HeadPriceSource; clock: () => number };
const OVERRIDE = Symbol.for('beefy.indexer.headPrices');
const override = () => (globalThis as { [OVERRIDE]?: Override })[OVERRIDE];

/** The process-wide cache, started at the first read; disabled in RPC fixture mode. */
const activeSource = (): HeadPriceSource => {
    const injected = override();
    if (injected !== undefined) return injected.source;
    if (source === undefined) {
        if (indexerConfig().rpcFixtures !== 'off') {
            source = disabled;
        } else {
            const cache = createHeadPriceCache();
            cache.start();
            source = cache;
        }
    }
    return source;
};

/** Tests: replace the cache and the clock (undefined restores the defaults). */
export const setHeadPriceSource = (next: HeadPriceSource | undefined, clock: () => number = Date.now) => {
    (globalThis as { [OVERRIDE]?: Override })[OVERRIDE] = next === undefined ? undefined : { source: next, clock };
};

/**
 * The cached price of `product` for an event at `blockTimestamp` (seconds), under the age rules: the event at most
 * HEAD_PRICE_EVENT_MAX_AGE_MS old and the price at most HEAD_PRICE_MAX_AGE_MS old, now (src/lib/config.ts).
 */
export const headPriceAt = (chainId: number, product: string, blockTimestamp: number): HeadPrice | undefined => {
    // read first: the cache starts during a historical sync, so it has prices when the indexer reaches the head
    const cache = activeSource();
    const { eventMaxAgeMs, priceMaxAgeMs } = indexerConfig().headPrices;
    const now = (override()?.clock ?? Date.now)();
    if (now - blockTimestamp * 1000 > eventMaxAgeMs) return undefined;
    const price = cache.get(chainId, product);
    return price !== undefined && now - price.fetchedAt <= priceMaxAgeMs ? price : undefined;
};
