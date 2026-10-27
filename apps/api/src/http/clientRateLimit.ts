import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';

import { type Cidr, resolveClientIp } from './clientIp.ts';
import type { createRateLimiter } from './rateLimit.ts';

const socketAddress = (context: Context): string => {
    try {
        return getConnInfo(context).remote.address ?? 'unknown';
    } catch {
        // not running behind the Node server (tests): everything is one client
        return 'unknown';
    }
};

/**
 * One token bucket per client address, applied to every request that reaches the origin, cached or not. Behind
 * Cloudflare the address is `CF-Connecting-IP`, believed only from Cloudflare's own ranges.
 */
export const clientRateLimit =
    (limiter: ReturnType<typeof createRateLimiter>, cloudflare: readonly Cidr[] | undefined): MiddlewareHandler =>
    async (context, next) => {
        const client = resolveClientIp({
            socketIp: socketAddress(context),
            connectingIpHeader: context.req.header('CF-Connecting-IP'),
            cloudflare,
        });
        const result = limiter.take(client);
        if (!result.allowed) {
            context.header('Retry-After', String(result.retryAfterSeconds));
            context.header('Cache-Control', 'no-store');
            return context.json({ error: { message: 'Too many requests' } }, 429);
        }
        await next();
    };
