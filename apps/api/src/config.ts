import { type ClickhouseConfig, clickhouseReader, type Env, integer, oneOf, parseEnv } from '@beefy/config';

export type ApiConfig = {
    port: number;
    clickhouse: ClickhouseConfig;
    /** Where the client address comes from for rate limiting: the socket, or `CF-Connecting-IP` from Cloudflare hops. */
    clientIp: 'socket' | 'cloudflare';
    /** Requests per client per minute, and the burst allowed. */
    clientRatePerMinute: number;
    clientBurst: number;
    /** Uncached requests (ClickHouse queries) per minute for all clients together, and the burst allowed. */
    missesPerMinute: number;
    missBurst: number;
    cacheMegabytes: number;
    maxInFlightQueries: number;
    maxQueuedQueries: number;
    queryTimeoutMs: number;
};

export const loadConfig = (env: Env): ApiConfig =>
    parseEnv(env, {
        port: integer('PORT', 3000, { min: 1, max: 65535 }),
        clickhouse: clickhouseReader,
        clientIp: oneOf('CLIENT_IP', ['socket', 'cloudflare'], 'socket'),
        clientRatePerMinute: integer('CLIENT_RATE_PER_MINUTE', 60, { min: 1, max: 100_000 }),
        clientBurst: integer('CLIENT_BURST', 20, { min: 1, max: 100_000 }),
        missesPerMinute: integer('MISSES_PER_MINUTE', 1500, { min: 1, max: 1_000_000 }),
        missBurst: integer('MISS_BURST', 100, { min: 1, max: 1_000_000 }),
        cacheMegabytes: integer('CACHE_MEGABYTES', 128, { min: 1, max: 16_384 }),
        maxInFlightQueries: integer('MAX_IN_FLIGHT_QUERIES', 8, { min: 1, max: 256 }),
        maxQueuedQueries: integer('MAX_QUEUED_QUERIES', 64, { min: 0, max: 10_000 }),
        queryTimeoutMs: integer('QUERY_TIMEOUT_MS', 3500, { min: 100, max: 60_000 }),
    });
