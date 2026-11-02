/**
 * Indexer prices (docs/architecture.md "Indexer prices"): the latest Beefy API share price of each contract, kept
 * in memory per chain and read synchronously by the timeline writers.
 *
 * - `/prices` and `/lps` merge into one oracle id -> price map: an oracle id is listed in one of them.
 * - A contract is found by chain and address in `/vaults/all`. A contract not listed there is found in `/boosts`, and
 *   takes the `/vaults/all` entry whose id is the boost's `poolId`.
 * - An entry with a `pricePerFullShare` is priced at oracle price * ppfs * 10^-tokenDecimals, per 10^18 share units
 *   (`HeadPrice.decimals`); any other is priced at its oracle price, per 10^`Contract.priceDecimals` share units.
 * - The ppfs is as fresh as the mappings, which is close enough for a temporary price.
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

/** `decimals`: the share units the price is per, when they are not the contract's `priceDecimals`. */
export type HeadPrice = { price: number; fetchedAt: number; decimals?: number | undefined };

/** Contract address (lowercase) -> latest price, per chain id. */
export type HeadPriceSource = { get: (chainId: number, contract: string) => HeadPrice | undefined };

/** Beefy API chain name of a chain id (the addressbook names are the API's: checked against `/vaults`). */
export const apiChainName = (chainId: number): string | undefined => (ChainId as Record<number, string>)[chainId];

// API answers are never trusted: each entry is validated alone and an invalid one is dropped (and counted in a log
// line); an answer whose shape is wrong as a whole counts as a failed fetch (the previous data is kept).

const addressSchema = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform(asHex);
const apiVaultSchema = z.object({
    id: z.string().min(1),
    oracleId: z.string().min(1),
    chain: z.string().min(1),
    /** A decimal string, sometimes in scientific notation; 0 prices nothing. Absent on CLMs and reward pools. */
    pricePerFullShare: z.coerce.number().nonnegative().optional(),
    tokenDecimals: z.number().int().nonnegative(),
    earnContractAddress: addressSchema,
});
const apiBoostSchema = z.object({
    poolId: z.string().min(1),
    chain: z.string().min(1),
    earnContractAddress: addressSchema,
});
/** A listed price: null and 0 are the API's "no price" (valid, not priced); anything else must be a positive number. */
const listedPriceSchema = z.number().nonnegative().nullable();
const jsonObjectSchema = z.custom<Record<string, unknown>>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
);

/** Prices by oracle id; only positive prices are kept. */
type Prices = ReadonlyMap<string, number>;
type Fetched<T> = { data: T; fetchedAt: number };

/** The share units of a price adjusted by ppfs. */
const PPFS_PRICE_DECIMALS = 18;

/** A contract's address, the oracle id its price is listed under, and its price for an oracle price of 1. */
type Mapping = { chain: string; oracleId: string; address: string; factor: number; decimals: number | undefined };
type ApiVault = z.infer<typeof apiVaultSchema>;
type ApiBoost = z.infer<typeof apiBoostSchema>;

const vaultMapping = ({
    chain,
    oracleId,
    earnContractAddress,
    pricePerFullShare,
    tokenDecimals,
}: ApiVault): Mapping => ({
    chain,
    oracleId,
    address: earnContractAddress,
    factor: pricePerFullShare === undefined ? 1 : pricePerFullShare / 10 ** tokenDecimals,
    decimals: pricePerFullShare === undefined ? undefined : PPFS_PRICE_DECIMALS,
});

/** The `/vaults/all` entries, then each boost under the entry of its `poolId`. */
const contractMappings = (vaults: ApiVault[], boosts: ApiBoost[]): Mapping[] => {
    const byPoolId = new Map(R.map(vaults, (vault) => [`${vault.chain}-${vault.id}`, vault] as const));
    const boosted = R.flatMap(boosts, ({ chain, poolId, earnContractAddress }) => {
        const vault = byPoolId.get(`${chain}-${poolId}`);
        return vault === undefined ? [] : [{ ...vaultMapping(vault), address: earnContractAddress }];
    });
    return [...R.map(vaults, vaultMapping), ...boosted];
};

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
    let vaults: ApiVault[] = [];
    let boosts: ApiBoost[] = [];
    let mappings: Mapping[] = [];
    let lpPrices: Fetched<Prices> | undefined;
    let tokenPrices: Fetched<Prices> | undefined;
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

    const parseList = <T>(path: string, data: unknown, schema: z.ZodType<T>): T[] | undefined => {
        if (!Array.isArray(data)) {
            onError(`head prices: ${path}: unexpected answer (not a list)`);
            return undefined;
        }
        return validated(path, data, schema);
    };

    /** The priced mappings of one endpoint; none before its first successful fetch. */
    const priced = (fetched: Fetched<Prices> | undefined) =>
        fetched === undefined
            ? []
            : R.flatMap(mappings, (mapping) => {
                  const price = (fetched.data.get(mapping.oracleId) ?? 0) * mapping.factor;
                  const { decimals } = mapping;
                  return price > 0 ? [{ ...mapping, head: { price, fetchedAt: fetched.fetchedAt, decimals } }] : [];
              });

    const rebuild = () => {
        byChain = R.pipe(
            [...priced(lpPrices), ...priced(tokenPrices)],
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
        const [lps, tokens] = await Promise.all([fetchJson('lps'), fetchJson('prices')]);
        lpPrices = refreshed(lpPrices, lps, (data) => parsePrices('/lps', data));
        tokenPrices = refreshed(tokenPrices, tokens, (data) => parsePrices('/prices', data));
        rebuild();
    };

    const refreshMappings = async () => {
        const [vaultList, boostList] = await Promise.all([fetchJson('vaults/all'), fetchJson('boosts')]);
        vaults = (vaultList && parseList('/vaults/all', vaultList.data, apiVaultSchema)) ?? vaults;
        boosts = (boostList && parseList('/boosts', boostList.data, apiBoostSchema)) ?? boosts;
        mappings = contractMappings(vaults, boosts);
        rebuild();
    };

    // no mappings yet (the first fetch failed): prices would attach to nothing until the next mappings period
    const refresh = async () => {
        if (vaults.length === 0 || boosts.length === 0) await refreshMappings();
        await refreshPrices();
    };

    const start = () => {
        if (timers.length > 0) return;
        void refresh();
        timers = [
            setInterval(() => void refresh(), pricesRefreshMs),
            setInterval(() => void refreshMappings(), mappingsRefreshMs),
        ];
        timers.forEach((timer) => timer.unref());
    };

    const stop = () => {
        timers.forEach((timer) => clearInterval(timer));
        timers = [];
    };

    const get = (chainId: number, contract: string) => {
        const chain = apiChainName(chainId);
        return chain === undefined ? undefined : byChain.get(chain)?.get(asHex(contract));
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

/** The process-wide cache, started once; disabled in RPC fixture mode. */
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

/** Starts the cache when the handlers load: an event some seconds after a restart finds prices, not only the next one. */
export const startHeadPrices = () => void activeSource();

/** Tests: replace the cache and the clock (undefined restores the defaults). */
export const setHeadPriceSource = (next: HeadPriceSource | undefined, clock: () => number = Date.now) => {
    (globalThis as { [OVERRIDE]?: Override })[OVERRIDE] = next === undefined ? undefined : { source: next, clock };
};

/**
 * The cached price of `contract` for an event at `blockTimestamp` (seconds), under the age rules: the event at most
 * HEAD_PRICE_EVENT_MAX_AGE_MS old and the price at most HEAD_PRICE_MAX_AGE_MS old, now (src/lib/config.ts).
 */
export const headPriceAt = (chainId: number, contract: string, blockTimestamp: number): HeadPrice | undefined => {
    const cache = activeSource();
    const { eventMaxAgeMs, priceMaxAgeMs } = indexerConfig().headPrices;
    const now = (override()?.clock ?? Date.now)();
    if (now - blockTimestamp * 1000 > eventMaxAgeMs) return undefined;
    const price = cache.get(chainId, contract);
    return price !== undefined && now - price.fetchedAt <= priceMaxAgeMs ? price : undefined;
};
