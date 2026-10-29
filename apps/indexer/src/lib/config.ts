/**
 * Indexer configuration: the only module of the handlers, effects and lib that reads `process.env`. Everything is
 * parsed and validated when the module loads (with the handlers, at startup); an invalid or missing value throws a
 * ConfigError listing every problem, which stops the indexer before it processes anything.
 *
 * Variables (all optional unless noted; .env.example documents them):
 * - ENVIO_RPC_URL_<chainId>: RPC of each indexed chain, for the cached effects. Required, except under vitest (where
 *   RPC fixtures answer, and a missing fixture is recorded from the chain's public RPC).
 * - RPC_TIMEOUT_MS, RPC_RETRY_COUNT, RPC_RETRY_DELAY_MS: viem transport of the effects.
 * - RPC_MULTICALL_MAX_CALLS, RPC_MULTICALL_MERGE_WAIT_MS: how multicall groups are merged into aggregate3 calls.
 * - RPC_FIXTURES: `record` (default under vitest), `replay` or `off`; only `off` outside vitest.
 * - BEEFY_API_URL and HEAD_PRICE_*: the head price cache (src/lib/headPrices.ts).
 */
import { indexer } from 'envio';
import * as R from 'remeda';
import { z } from 'zod';

import { type Env, enumVar, intVar, optionalUrlVar, parseEnv, requiredUrlVar, urlVar } from './env';

export type RpcFixtureMode = 'off' | 'record' | 'replay';

export type IndexerConfig = {
    /** RPC endpoint per chain id; unset only under vitest. */
    rpcUrls: ReadonlyMap<number, string>;
    rpc: {
        timeoutMs: number;
        retryCount: number;
        retryDelayMs: number;
        /** Max sub-calls merged into one aggregate3 (a lone larger group still runs as one call). */
        multicallMaxCalls: number;
        /** Window during which multicall groups for the same block are collected into a shared eth_call. */
        multicallMergeWaitMs: number;
    };
    rpcFixtures: RpcFixtureMode;
    beefyApiUrl: string;
    headPrices: {
        /** An event older than this when its handler runs gets no price (an event indexed during a historical sync). */
        eventMaxAgeMs: number;
        /** A price older than this is not used (a stuck refresh stops pricing instead of spreading an old price). */
        priceMaxAgeMs: number;
        pricesRefreshMs: number;
        mappingsRefreshMs: number;
    };
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const rpcUrlVar = (chainId: number) => `ENVIO_RPC_URL_${chainId}`;

/** Parses and validates the configuration of an indexer of `chainIds` from `env`; throws a ConfigError. */
export const loadIndexerConfig = (env: Env, chainIds: readonly number[]): IndexerConfig => {
    const underVitest = env.VITEST === 'true';
    const rpcUrlShape = R.pipe(
        chainIds,
        R.map((chainId) => [rpcUrlVar(chainId), underVitest ? optionalUrlVar() : requiredUrlVar()] as const),
        R.fromEntries()
    );
    const parsed = parseEnv(
        z.object({
            ...rpcUrlShape,
            RPC_TIMEOUT_MS: intVar(30_000, { min: 1_000, max: 10 * MINUTE_MS }),
            RPC_RETRY_COUNT: intVar(5, { min: 0, max: 20 }),
            RPC_RETRY_DELAY_MS: intVar(500, { min: 0, max: MINUTE_MS }),
            RPC_MULTICALL_MAX_CALLS: intVar(64, { min: 1, max: 5_000 }),
            RPC_MULTICALL_MERGE_WAIT_MS: intVar(16, { min: 0, max: 1_000 }),
            RPC_FIXTURES: underVitest
                ? enumVar(['record', 'replay', 'off'], 'record')
                : z.preprocess(
                      (value) => (value === '' ? undefined : value),
                      z
                          .enum(['off'], { error: 'RPC fixtures only run under vitest: unset it or set it to off' })
                          .default('off')
                  ),
            BEEFY_API_URL: urlVar('https://api.beefy.finance'),
            HEAD_PRICE_EVENT_MAX_AGE_MS: intVar(10 * MINUTE_MS, { min: 0, max: 24 * HOUR_MS }),
            HEAD_PRICE_MAX_AGE_MS: intVar(15 * MINUTE_MS, { min: MINUTE_MS, max: 24 * HOUR_MS }),
            HEAD_PRICE_REFRESH_MS: intVar(MINUTE_MS, { min: 5_000, max: HOUR_MS }),
            HEAD_PRICE_MAPPINGS_REFRESH_MS: intVar(10 * MINUTE_MS, { min: 5_000, max: 24 * HOUR_MS }),
        }),
        env
    );
    const values = parsed as Record<string, unknown>;
    return {
        rpcUrls: new Map(
            R.pipe(
                chainIds,
                R.map((chainId) => [chainId, values[rpcUrlVar(chainId)]] as const),
                R.filter((entry): entry is readonly [number, string] => typeof entry[1] === 'string')
            )
        ),
        rpc: {
            timeoutMs: parsed.RPC_TIMEOUT_MS,
            retryCount: parsed.RPC_RETRY_COUNT,
            retryDelayMs: parsed.RPC_RETRY_DELAY_MS,
            multicallMaxCalls: parsed.RPC_MULTICALL_MAX_CALLS,
            multicallMergeWaitMs: parsed.RPC_MULTICALL_MERGE_WAIT_MS,
        },
        rpcFixtures: parsed.RPC_FIXTURES,
        beefyApiUrl: parsed.BEEFY_API_URL.replace(/\/+$/, ''),
        headPrices: {
            eventMaxAgeMs: parsed.HEAD_PRICE_EVENT_MAX_AGE_MS,
            priceMaxAgeMs: parsed.HEAD_PRICE_MAX_AGE_MS,
            pricesRefreshMs: parsed.HEAD_PRICE_REFRESH_MS,
            mappingsRefreshMs: parsed.HEAD_PRICE_MAPPINGS_REFRESH_MS,
        },
    };
};

// parsed once, when the handlers load: a bad value stops the indexer here
const config = loadIndexerConfig(process.env, indexer.chainIds);

/** The configuration parsed at startup. */
export const indexerConfig = (): IndexerConfig => config;
