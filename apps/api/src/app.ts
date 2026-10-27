import { OpenAPIHono } from '@hono/zod-openapi';
import { etag } from 'hono/etag';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { timeout } from 'hono/timeout';

import pkg from '../package.json' with { type: 'json' };
import { type Cidr } from './http/clientIp.ts';
import { clientRateLimit } from './http/clientRateLimit.ts';
import type { createRateLimiter } from './http/rateLimit.ts';
import { registerHealth } from './routes/health.ts';
import { registerTimeline, type TimelineRouteDeps } from './routes/timeline.ts';

const REQUEST_TIMEOUT_MS = 10_000;

export type AppDeps = {
    /** Without it only the health check and the documentation are served. */
    timeline?: TimelineRouteDeps & {
        clientLimiter: ReturnType<typeof createRateLimiter>;
        /** Cloudflare's ranges when `CF-Connecting-IP` is to be believed from them. */
        cloudflare: readonly Cidr[] | undefined;
    };
};

export const createApp = ({ timeline }: AppDeps = {}): OpenAPIHono => {
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
    if (timeline !== undefined) {
        app.use('/v1/*', clientRateLimit(timeline.clientLimiter, timeline.cloudflare));
        registerTimeline(app, timeline);
    }

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
