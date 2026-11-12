import { type Env, integer, listOf, oneOf, optionalString, parseEnv, requiredUrl } from '@beefy/config';

/** What the proxy may answer from its cache. Everything is recorded whatever this says. */
export const servable = ['logs', 'blocks', 'txs', 'calls'] as const;
export type Servable = (typeof servable)[number];

export type ProxyConfig = {
    chainId: number;
    /** Where cache misses and everything uncacheable go: the node, or an rpc-pacer in front of it. */
    upstreamUrl: string;
    port: number;
    databaseUrl: string;
    /** Connections for lookups; the recorder writes on one more. */
    databaseConnections: number;
    serve: ReadonlySet<Servable>;
    /** `false` forwards everything and records nothing. */
    cache: boolean;
    /** Blocks at least this far below the head are final: only those are served from the cache. */
    reorgDepth: number;
    /** A JSON file rewritten every `reportSeconds` with the counters and timings; empty means none. */
    statsFile: string;
    reportSeconds: number;
    /** Rows waiting for a write above which new ones are dropped, so recording never holds an answer back. */
    maxQueue: number;
    flushMilliseconds: number;
};

/** Parses the environment, every problem at once. */
export const loadConfig = (env: Env): ProxyConfig => {
    const parsed = parseEnv(
        env,
        {
            chainId: integer('CHAIN_ID', 0, { min: 0, max: 2_147_483_647 }),
            upstreamUrl: requiredUrl('UPSTREAM_URL', ['http:', 'https:']),
            port: integer('PORT', 0, { min: 0, max: 65_535 }),
            databaseUrl: requiredUrl('DATABASE_URL', ['postgres:', 'postgresql:']),
            databaseConnections: integer('DB_MAX', 8, { min: 1, max: 100 }),
            serve: listOf('SERVE', servable, []),
            cache: oneOf('CACHE', ['on', 'off'], 'on'),
            reorgDepth: integer('REORG_DEPTH', 200, { min: 1, max: 100_000 }),
            statsFile: optionalString('STATS_FILE', ''),
            reportSeconds: integer('REPORT_SECONDS', 30, { min: 1, max: 3_600 }),
            maxQueue: integer('MAX_QUEUE', 500_000, { min: 1_000, max: 100_000_000 }),
            flushMilliseconds: integer('FLUSH_MS', 250, { min: 10, max: 60_000 }),
        },
        (value, problems) => {
            if (value.chainId === 0) problems.push('CHAIN_ID is required');
            if (value.port === 0) problems.push('PORT is required');
        }
    );
    return { ...parsed, serve: new Set(parsed.serve), cache: parsed.cache === 'on' };
};

/** The only place that reads `process.env`. */
export const readConfig = (): ProxyConfig => loadConfig(process.env);
