import { describe, expect, it } from 'vitest';

import { createApp } from './app.ts';

const app = createApp();

describe('api', () => {
    it('answers the health check', async () => {
        const response = await app.request('/healthz');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
    });

    it('serves an OpenAPI 3.1 document describing the routes', async () => {
        const response = await app.request('/openapi.json');
        const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
        expect(doc.openapi).toBe('3.1.0');
        expect(Object.keys(doc.paths)).toEqual(['/healthz']);
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
