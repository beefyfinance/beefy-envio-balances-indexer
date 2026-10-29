import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';

import { type Cidr, type ClientIpSource, clientKey, resolveClientIp } from './clientIp.ts';
import type { Metrics } from './metrics.ts';
import type { createRateLimiter } from './rateLimit.ts';

declare module 'hono' {
    interface ContextVariableMap {
        /** The client's rate limit key ({@link clientKey}), set by {@link clientRateLimit}. */
        clientKey: string;
    }
}

const socketAddress = (context: Context): string => {
    try {
        return getConnInfo(context).remote.address ?? 'unknown';
    } catch {
        // not running behind the Node server (tests): everything is one client
        return 'unknown';
    }
};

/**
 * One token bucket per client, applied to every request that reaches the origin, cached or not. The client is resolved
 * from the proxies in front of us ({@link resolveClientIp}) and keyed by {@link clientKey}; the key is left in the
 * context for the per-client limit of uncached requests.
 */
export const clientRateLimit =
    (
        limiter: ReturnType<typeof createRateLimiter>,
        { source, cloudflare }: { source: ClientIpSource; cloudflare: readonly Cidr[] },
        metrics?: Metrics
    ): MiddlewareHandler =>
    async (context, next) => {
        const client = clientKey(
            resolveClientIp({
                source,
                socketIp: socketAddress(context),
                forwardedFor: context.req.header('X-Forwarded-For'),
                connectingIp: context.req.header('CF-Connecting-IP'),
                cloudflare,
            })
        );
        context.set('clientKey', client);
        const result = limiter.take(client);
        if (!result.allowed) {
            metrics?.increment('beefy_rate_limited_total', { kind: 'client' });
            context.header('Retry-After', String(result.retryAfterSeconds));
            context.header('Cache-Control', 'no-store');
            return context.json({ error: { message: 'Too many requests' } }, 429);
        }
        await next();
    };
