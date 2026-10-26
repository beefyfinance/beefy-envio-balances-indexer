import type { MiddlewareHandler } from 'hono';

/**
 * `Cache-Control` for successful GETs. `hono/cache` needs the Web Cache API, which Node does not have, so caching is
 * left to HTTP: browsers and any CDN in front honour this, and `etag` makes revalidation cheap.
 * Server side caching belongs to the data layer (ClickHouse's query cache).
 */
export const cacheControl =
    ({
        maxAgeSeconds,
        staleWhileRevalidateSeconds = 0,
    }: {
        maxAgeSeconds: number;
        staleWhileRevalidateSeconds?: number;
    }): MiddlewareHandler =>
    async (context, next) => {
        await next();
        if (context.req.method !== 'GET' || context.res.status !== 200 || context.res.headers.has('Cache-Control'))
            return;
        const swr = staleWhileRevalidateSeconds > 0 ? `, stale-while-revalidate=${staleWhileRevalidateSeconds}` : '';
        context.header('Cache-Control', `public, max-age=${maxAgeSeconds}${swr}`);
    };
