import { describeError } from '@beefy/config';
import { OpenAPIHono } from '@hono/zod-openapi';
import { etag } from 'hono/etag';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { timeout } from 'hono/timeout';

import pkg from '../package.json' with { type: 'json' };
import type { Cidr, ClientIpSource } from './http/clientIp.ts';
import { clientRateLimit } from './http/clientRateLimit.ts';
import type { createRateLimiter } from './http/rateLimit.ts';
import { log } from './lib/log.ts';
import { registerHealth } from './routes/health.ts';
import { type OpsDeps, registerOps } from './routes/ops.ts';
import { registerTimeline, type TimelineRouteDeps } from './routes/timeline.ts';

export type AppDeps = {
    /** Every request is cut after this long (10 seconds by default). */
    requestTimeoutMs?: number;
    /** `/health` and `/metrics`; without it (no `OPS_TOKEN`) they do not exist. */
    ops?: OpsDeps;
    /** Without it only the health check and the documentation are served. */
    timeline?: TimelineRouteDeps & {
        clientLimiter: ReturnType<typeof createRateLimiter>;
        /** Where the client address comes from, and Cloudflare's ranges, from which `CF-Connecting-IP` is believed. */
        clientIp: { source: ClientIpSource; cloudflare: readonly Cidr[] };
    };
};

export const createApp = ({ timeline, ops, requestTimeoutMs = 10_000 }: AppDeps = {}): OpenAPIHono => {
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
    app.use(timeout(requestTimeoutMs));
    app.use(etag());

    registerHealth(app);
    if (ops !== undefined) registerOps(app, ops);
    if (timeline !== undefined) {
        app.use('/v1/*', clientRateLimit(timeline.clientLimiter, timeline.clientIp, timeline.metrics));
        registerTimeline(app, timeline);
    }

    app.doc31('/openapi.json', {
        openapi: '3.1.0',
        info: { title: 'Beefy balances API', version: pkg.version },
    });

    app.notFound((context) => context.json({ error: { message: 'Not found' } }, 404));
    app.onError((error, context) => {
        // a deliberate HTTP answer (the request timeout's 504): its status, with our error shape and never cached
        if (error instanceof HTTPException) {
            context.header('Cache-Control', 'no-store');
            const message = error.status === 504 ? 'Request timed out' : 'Request failed';
            return context.json({ error: { message, requestId: context.get('requestId') } }, error.status);
        }
        // details stay in the logs; the caller gets the request id to quote
        log.error({ event: 'request-failed', requestId: context.get('requestId'), error: describeError(error) });
        return context.json({ error: { message: 'Internal error', requestId: context.get('requestId') } }, 500);
    });

    return app;
};
