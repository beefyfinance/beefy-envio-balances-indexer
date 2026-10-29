import { timingSafeEqual } from 'node:crypto';

import type { ApiStatus } from '@beefy/clickhouse';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';

import type { Metrics } from '../http/metrics.ts';

export type OpsDeps = {
    /** The active version and its price watermark, or undefined when they cannot be read. Memoised by the caller. */
    status: () => Promise<ApiStatus | undefined>;
    stats: () => { bytes: number; entries: number; queued: number; inFlight: number };
    metrics: Metrics;
    /** A watermark older than this makes the service report `degraded`; no watermark yet is `pending`. */
    watermarkWarnSeconds: number;
    /** `/health` and `/metrics` need `Authorization: Bearer <token>`. */
    token: string;
};

const authorized = (context: Context, token: string): boolean => {
    const given = Buffer.from(context.req.header('Authorization') ?? '');
    const wanted = Buffer.from(`Bearer ${token}`);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
};

const health = (current: ApiStatus | undefined, warnSeconds: number): 'ok' | 'pending' | 'degraded' => {
    if (current === undefined) return 'degraded';
    if (current.watermarkAgeSeconds === null) return 'pending';
    return current.watermarkAgeSeconds > warnSeconds ? 'degraded' : 'ok';
};

/**
 * `/healthz` (liveness, in health.ts) says the process is up. `/health` says whether the data is current: rows past the
 * price watermark keep their indexer price or provisional row, so an old watermark (a price source or the worker
 * stopped) leaves more rows provisional but serves them; this is `degraded`, never an error that would pull the
 * instance out of rotation. An active version whose first advance has not run yet has no watermark at all, which is
 * expected right after a switch to a fresh version, so it is `pending`, not `degraded`. `/metrics` is the same
 * numbers, and the request counters, for Prometheus (no watermark age while pending).
 */
export const registerOps = (
    app: OpenAPIHono,
    { status, stats, metrics, watermarkWarnSeconds, token }: OpsDeps
): void => {
    app.get('/health', async (context) => {
        if (!authorized(context, token)) return context.json({ error: { message: 'Unauthorized' } }, 401);
        const current = await status();
        context.header('Cache-Control', 'no-store');
        return context.json({
            status: health(current, watermarkWarnSeconds),
            version: current?.version ?? null,
            watermark: current?.watermark ?? null,
            watermark_age_seconds: current?.watermarkAgeSeconds ?? null,
            watermark_warn_seconds: watermarkWarnSeconds,
            cache: stats(),
        });
    });

    app.get('/metrics', async (context) => {
        if (!authorized(context, token)) return context.json({ error: { message: 'Unauthorized' } }, 401);
        const { bytes, entries, queued, inFlight } = stats();
        const current = await status();
        context.header('Cache-Control', 'no-store');
        context.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        return context.body(
            metrics.render({
                beefy_active_version: current?.version,
                beefy_watermark_age_seconds: current?.watermarkAgeSeconds ?? undefined,
                beefy_cache_bytes: bytes,
                beefy_cache_entries: entries,
                beefy_db_queries_queued: queued,
                beefy_db_queries_in_flight: inFlight,
            })
        );
    });
};
