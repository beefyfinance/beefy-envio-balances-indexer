import { CHAINS } from '@beefy/models';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.ts';

const app = createApp();

describe('api', () => {
    it('answers the health check', async () => {
        const response = await app.request('/healthz');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
    });

    it('lists the indexed chains with HTTP caching headers', async () => {
        const response = await app.request('/v1/chains');
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
        const body = (await response.json()) as { chains: { id: number; key: string }[] };
        expect(body.chains).toHaveLength(CHAINS.length);
        expect(body.chains).toContainEqual({ id: 8453, key: 'base' });
    });

    it('revalidates with an ETag', async () => {
        const first = await app.request('/v1/chains');
        const tag = first.headers.get('etag');
        expect(tag).toBeTruthy();
        const second = await app.request('/v1/chains', { headers: { 'if-none-match': tag as string } });
        expect(second.status).toBe(304);
    });

    it('serves an OpenAPI 3.1 document describing the routes', async () => {
        const response = await app.request('/openapi.json');
        const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
        expect(doc.openapi).toBe('3.1.0');
        expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/healthz', '/v1/chains']));
    });

    it('sends security headers and a request id', async () => {
        const response = await app.request('/healthz');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('x-request-id')).toBeTruthy();
    });

    it('404s unknown routes as JSON', async () => {
        const response = await app.request('/nope');
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: { message: 'Not found' } });
    });
});
