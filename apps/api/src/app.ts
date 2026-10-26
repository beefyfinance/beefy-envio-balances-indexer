import { OpenAPIHono } from '@hono/zod-openapi';
import { etag } from 'hono/etag';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { timeout } from 'hono/timeout';

import pkg from '../package.json' with { type: 'json' };
import { registerChains } from './routes/chains.ts';
import { registerHealth } from './routes/health.ts';

const REQUEST_TIMEOUT_MS = 10_000;

export const createApp = (): OpenAPIHono => {
    const app = new OpenAPIHono({
        // a request that does not match its schema is the caller's mistake: 400 with the reasons, never a 500
        defaultHook: (result, context) => {
            if (!result.success) {
                return context.json({ error: { message: 'Invalid request', issues: result.error.issues } }, 400);
            }
        },
    });

    app.use(requestId());
    app.use(secureHeaders());
    app.use(timeout(REQUEST_TIMEOUT_MS));
    app.use(etag());

    registerHealth(app);
    registerChains(app);

    app.doc31('/openapi.json', {
        openapi: '3.1.0',
        info: { title: 'Beefy balances API', version: pkg.version },
    });

    app.notFound((context) => context.json({ error: { message: 'Not found' } }, 404));
    app.onError((error, context) => {
        // details stay in the logs; the caller gets the request id to quote
        console.error(
            JSON.stringify({ event: 'request-failed', requestId: context.get('requestId'), error: String(error) })
        );
        return context.json({ error: { message: 'Internal error', requestId: context.get('requestId') } }, 500);
    });

    return app;
};
