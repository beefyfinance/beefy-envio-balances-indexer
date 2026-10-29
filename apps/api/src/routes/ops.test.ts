import { describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { createMetrics } from '../http/metrics.ts';
import type { OpsDeps } from './ops.ts';

const TOKEN = 'a'.repeat(32);

const make = (overrides: Partial<OpsDeps> = {}) => {
    const metrics = createMetrics();
    const app = createApp({
        ops: {
            status: () => Promise.resolve({ version: 2, watermark: '2026-10-27 00:00:00.000', watermarkAgeSeconds: 3 }),
            stats: () => ({ bytes: 10, entries: 2, queued: 0, inFlight: 1 }),
            metrics,
            watermarkWarnSeconds: 60,
            token: TOKEN,
            ...overrides,
        },
    });
    const get = (path: string) => app.request(path, { headers: { Authorization: `Bearer ${TOKEN}` } });
    return { app, metrics, get };
};

describe('/health and /metrics', () => {
    it('reports ok with the version, the watermark and the cache, and is never cached', async () => {
        const response = await make().get('/health');
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({
            status: 'ok',
            version: 2,
            watermark: '2026-10-27 00:00:00.000',
            watermark_age_seconds: 3,
            watermark_warn_seconds: 60,
            cache: { bytes: 10, entries: 2, queued: 0, inFlight: 1 },
        });
    });

    it('is degraded, not an error, when the watermark is old or cannot be read', async () => {
        const late = await make({
            status: () =>
                Promise.resolve({ version: 2, watermark: '2026-10-27 00:00:00.000', watermarkAgeSeconds: 61 }),
        }).get('/health');
        expect(late.status).toBe(200);
        expect(await late.json()).toMatchObject({ status: 'degraded', watermark_age_seconds: 61 });
        const unknown = await make({ status: () => Promise.resolve(undefined) }).get('/health');
        expect(await unknown.json()).toMatchObject({ status: 'degraded', version: null, watermark_age_seconds: null });
    });

    it('is pending, not degraded, while the active version has no watermark yet, and exports no age then', async () => {
        const { get } = make({
            status: () => Promise.resolve({ version: 3, watermark: null, watermarkAgeSeconds: null }),
        });
        const response = await get('/health');
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            status: 'pending',
            version: 3,
            watermark: null,
            watermark_age_seconds: null,
        });
        const text = await (await get('/metrics')).text();
        expect(text).toContain('beefy_active_version 3');
        expect(text).not.toContain('beefy_watermark_age_seconds');
    });

    it('exposes the version, the watermark age, the cache and the counters in Prometheus format', async () => {
        const { get, metrics } = make();
        metrics.increment('beefy_timeline_requests_total', { result: 'hit' });
        const text = await (await get('/metrics')).text();
        expect(text).toContain('beefy_active_version 2');
        expect(text).toContain('beefy_watermark_age_seconds 3');
        expect(text).toContain('beefy_cache_bytes 10');
        expect(text).toContain('beefy_timeline_requests_total{result="hit"} 1');
    });

    it('needs the bearer token', async () => {
        const { app, get } = make();
        expect((await app.request('/health')).status).toBe(401);
        expect((await app.request('/metrics', { headers: { Authorization: 'Bearer wrong-token' } })).status).toBe(401);
        expect((await get('/metrics')).status).toBe(200);
        expect((await app.request('/healthz')).status).toBe(200);
    });

    it('does not exist without a token', async () => {
        const app = createApp();
        expect((await app.request('/health')).status).toBe(404);
        expect((await app.request('/metrics')).status).toBe(404);
        expect((await app.request('/healthz')).status).toBe(200);
    });
});
