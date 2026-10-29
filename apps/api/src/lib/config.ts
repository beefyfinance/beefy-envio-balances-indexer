import {
    type ClickhouseReaderConfig,
    clickhouseReader,
    ConfigError,
    type Env,
    integer,
    oneOf,
    optionalString,
    parseEnv,
} from '@beefy/config';

import type { ClientIpSource } from '../http/clientIp.ts';

/**
 * The API's configuration, and the only place of the API that reads `process.env` ({@link readConfig}). Everything is
 * parsed and checked at startup: a missing or invalid value stops the process before it serves anything.
 */
export type ApiConfig = {
    port: number;
    clickhouse: ClickhouseReaderConfig;
    /** Where the client address for rate limiting comes from (see `resolveClientIp`). */
    clientIp: ClientIpSource;
    /** Requests per client per minute, and the burst allowed. */
    clientRatePerMinute: number;
    clientBurst: number;
    /** Uncached requests (ClickHouse queries) per minute for all clients together, and the burst allowed. */
    missesPerMinute: number;
    missBurst: number;
    /** Uncached requests per client per minute, and the burst allowed. */
    clientMissesPerMinute: number;
    clientMissBurst: number;
    cacheMegabytes: number;
    maxInFlightQueries: number;
    maxQueuedQueries: number;
    /** How long a query may wait in the queue before the request is refused (503). */
    maxQueueWaitMs: number;
    queryTimeoutMs: number;
    /** Rows of one account above which its timeline is refused (413) instead of built. */
    maxTimelineRows: number;
    /** Every request is cut after this long. */
    requestTimeoutMs: number;
    /** How often the active version and its watermark are read (`api_status`), and how long that read may take. */
    statusRefreshSeconds: number;
    statusTimeoutMs: number;
    /** How often the list of Beefy's own contracts (not users) is read again. */
    productContractsRefreshMinutes: number;
    /** Age of the active version's price watermark above which `/health` says degraded. */
    watermarkWarnSeconds: number;
    /** On SIGTERM, how long in-flight requests get before the process exits anyway. */
    shutdownGraceSeconds: number;
    /** Bearer token for `/health` and `/metrics`; unset means they are not served at all. */
    opsToken: string | undefined;
};

export const loadConfig = (env: Env): ApiConfig =>
    parseEnv(env, {
        port: integer('PORT', 3000, { min: 1, max: 65535 }),
        clickhouse: clickhouseReader(),
        clientIp: oneOf('CLIENT_IP', ['socket', 'cloudflare', 'heroku-cloudflare'], 'socket'),
        clientRatePerMinute: integer('CLIENT_RATE_PER_MINUTE', 60, { min: 1, max: 100_000 }),
        clientBurst: integer('CLIENT_BURST', 20, { min: 1, max: 100_000 }),
        missesPerMinute: integer('MISSES_PER_MINUTE', 1500, { min: 1, max: 1_000_000 }),
        missBurst: integer('MISS_BURST', 100, { min: 1, max: 1_000_000 }),
        clientMissesPerMinute: integer('CLIENT_MISSES_PER_MINUTE', 20, { min: 1, max: 100_000 }),
        clientMissBurst: integer('CLIENT_MISS_BURST', 10, { min: 1, max: 100_000 }),
        cacheMegabytes: integer('CACHE_MEGABYTES', 128, { min: 1, max: 16_384 }),
        maxInFlightQueries: integer('MAX_IN_FLIGHT_QUERIES', 4, { min: 1, max: 256 }),
        maxQueuedQueries: integer('MAX_QUEUED_QUERIES', 64, { min: 0, max: 10_000 }),
        maxQueueWaitMs: integer('MAX_QUEUE_WAIT_MS', 250, { min: 0, max: 60_000 }),
        queryTimeoutMs: integer('QUERY_TIMEOUT_MS', 3500, { min: 100, max: 60_000 }),
        maxTimelineRows: integer('MAX_TIMELINE_ROWS', 10_000, { min: 100, max: 1_000_000 }),
        requestTimeoutMs: integer('REQUEST_TIMEOUT_MS', 10_000, { min: 1000, max: 120_000 }),
        // a switch is picked up within this long: keep it no longer than the origin's own freshness (10 to 45 seconds)
        statusRefreshSeconds: integer('STATUS_REFRESH_SECONDS', 10, { min: 1, max: 600 }),
        statusTimeoutMs: integer('STATUS_TIMEOUT_MS', 3000, { min: 100, max: 60_000 }),
        productContractsRefreshMinutes: integer('PRODUCT_CONTRACTS_REFRESH_MINUTES', 60, { min: 1, max: 24 * 60 }),
        watermarkWarnSeconds: integer('WATERMARK_ALERT_SECONDS', 2 * 86_400, { min: 3600, max: 30 * 86_400 }),
        // Heroku gives a process 30 seconds after SIGTERM
        shutdownGraceSeconds: integer('SHUTDOWN_GRACE_SECONDS', 10, { min: 1, max: 30 }),
        opsToken: (e: Env, problems: string[]): string | undefined => {
            const token = optionalString('OPS_TOKEN', '')(e, problems);
            if (token === '') return undefined;
            // the endpoints are on the public hostname: a token that can be guessed is no protection
            if (token.length < 32) problems.push('OPS_TOKEN must be at least 32 characters (openssl rand -hex 32)');
            return token;
        },
    });

/** {@link loadConfig} of the process environment; on a problem, says what is wrong and exits. */
export const readConfig = (): ApiConfig => {
    try {
        return loadConfig(process.env);
    } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    }
};

/** The scratch ClickHouse the integration tests use (`CLICKHOUSE_URL`); they are skipped without one. */
export const integrationClickhouseUrl = (): string | undefined => process.env['CLICKHOUSE_URL'];
