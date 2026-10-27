import { createClickhouseClient } from '@beefy/clickhouse';
import { redact } from '@beefy/config';
import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createBlockedSet } from './http/blocked.ts';
import { CLOUDFLARE_RANGES, parseCidr } from './http/clientIp.ts';
import { createRateLimiter } from './http/rateLimit.ts';
import { clickhouseTimelineRepository } from './timeline/repository.ts';
import { createTimelineService } from './timeline/service.ts';

const config = loadConfig(process.env);
const client = createClickhouseClient({
    url: config.clickhouse.url,
    username: config.clickhouse.username,
    password: config.clickhouse.password,
});
const service = createTimelineService({
    repository: clickhouseTimelineRepository(client, config.clickhouse.analyticsDatabase, config.queryTimeoutMs),
    cacheBytes: config.cacheMegabytes * 1024 * 1024,
    missesPerMinute: config.missesPerMinute,
    missBurst: config.missBurst,
    maxInFlight: config.maxInFlightQueries,
    maxQueue: config.maxQueuedQueries,
    maxQueueWaitMs: 250,
});

// Beefy's own contracts are not users: refresh the list hourly, and keep the last good one if a refresh fails.
const blocked = createBlockedSet();
const refreshBlocked = async (): Promise<void> => {
    try {
        blocked.replace(await service.productContracts());
    } catch (error) {
        console.error(JSON.stringify({ event: 'blocked-refresh-failed', error: String(error) }));
    }
};
await refreshBlocked();
setInterval(() => void refreshBlocked(), 3600_000).unref();

const app = createApp({
    timeline: {
        service,
        blocked: blocked.current,
        clientLimiter: createRateLimiter({ ratePerMinute: config.clientRatePerMinute, burst: config.clientBurst }),
        cloudflare: config.clientIp === 'cloudflare' ? CLOUDFLARE_RANGES.map(parseCidr) : undefined,
    },
});

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
    console.log(
        JSON.stringify({
            app: 'api',
            port,
            clickhouse: redact(config.clickhouse.url),
            analyticsDatabase: config.clickhouse.analyticsDatabase,
            clientIp: config.clientIp,
        })
    );
});

// Heroku sends SIGTERM on every restart and gives the process 30 seconds.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        setTimeout(() => process.exit(1), 10_000).unref();
        server.close(() => process.exit(0));
    });
}
