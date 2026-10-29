import { type ApiStatus, createClickhouseClient } from '@beefy/clickhouse';
import { describeError, redact } from '@beefy/config';
import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { createBlockedSet } from './http/blocked.ts';
import { cloudflareRanges, parseCidr } from './http/clientIp.ts';
import { createMetrics } from './http/metrics.ts';
import { createRateLimiter } from './http/rateLimit.ts';
import { readConfig } from './lib/config.ts';
import { log } from './lib/log.ts';
import { readApiStatus } from './status.ts';
import { clickhouseTimelineRepository } from './timeline/repository.ts';
import { createTimelineService } from './timeline/service.ts';

const config = readConfig();
const client = createClickhouseClient({
    url: config.clickhouse.url,
    username: config.clickhouse.username,
    password: config.clickhouse.password,
    // the API user is readonly: the client sends no setting at all
    readonly: true,
});
// The active version and its watermark, read every STATUS_REFRESH_SECONDS in the background rather than per request:
// the version is part of every timeline cache key (a switch must not serve timelines cached from the previous version)
// and a lookup in the hot path would cost a query per request. A switch is therefore picked up within that time, no
// longer than the origin's own freshness (10 to 45 seconds) and the edge's, and the old version's entries simply age
// out of the LRU. /health and /metrics read the same value.
// `current` keeps the last good status when a read fails; the health check says unreadable (undefined) instead.
let current: ApiStatus | undefined;
let readable = false;
const refreshStatus = async (): Promise<void> => {
    try {
        current = await readApiStatus(client, config.clickhouse.analyticsDatabase, config.statusTimeoutMs);
        readable = true;
    } catch (error) {
        readable = false;
        log.error({ event: 'api-status-unreadable', error: describeError(error) });
    }
};
await refreshStatus();
setInterval(() => void refreshStatus(), config.statusRefreshSeconds * 1000).unref();

const service = createTimelineService({
    repository: clickhouseTimelineRepository(
        client,
        config.clickhouse.analyticsDatabase,
        config.queryTimeoutMs,
        config.maxTimelineRows
    ),
    cacheBytes: config.cacheMegabytes * 1024 * 1024,
    missesPerMinute: config.missesPerMinute,
    missBurst: config.missBurst,
    clientMissesPerMinute: config.clientMissesPerMinute,
    clientMissBurst: config.clientMissBurst,
    maxInFlight: config.maxInFlightQueries,
    maxQueue: config.maxQueuedQueries,
    maxQueueWaitMs: config.maxQueueWaitMs,
    version: () => current?.version,
});

// Beefy's own contracts are not users: refresh the list now and then, and keep the last good one if a refresh fails.
const blocked = createBlockedSet();
const refreshBlocked = async (): Promise<void> => {
    try {
        blocked.replace(await service.productContracts());
    } catch (error) {
        log.error({ event: 'blocked-refresh-failed', error: describeError(error) });
    }
};
await refreshBlocked();
setInterval(() => void refreshBlocked(), config.productContractsRefreshMinutes * 60_000).unref();

const metrics = createMetrics();

const app = createApp({
    requestTimeoutMs: config.requestTimeoutMs,
    // no token, no /health and /metrics: they are never open on the public hostname
    ops:
        config.opsToken === undefined
            ? undefined
            : {
                  status: () => Promise.resolve(readable ? current : undefined),
                  stats: () => service.stats,
                  metrics,
                  watermarkWarnSeconds: config.watermarkWarnSeconds,
                  token: config.opsToken,
              },
    timeline: {
        metrics,
        service,
        blocked: blocked.current,
        clientLimiter: createRateLimiter({ ratePerMinute: config.clientRatePerMinute, burst: config.clientBurst }),
        clientIp: { source: config.clientIp, cloudflare: cloudflareRanges().map(parseCidr) },
    },
});

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
    log.info({
        event: 'started',
        port,
        clickhouse: redact(config.clickhouse.url),
        analyticsDatabase: config.clickhouse.analyticsDatabase,
        version: current?.version ?? null,
        clientIp: config.clientIp,
        ops: config.opsToken !== undefined,
    });
});

// Heroku sends SIGTERM on every restart and gives the process 30 seconds.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        setTimeout(() => process.exit(1), config.shutdownGraceSeconds * 1000).unref();
        server.close(() => process.exit(0));
    });
}
