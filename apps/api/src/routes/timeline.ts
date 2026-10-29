import { timelinePriceFlags, timelinePriceResolutions } from '@beefy/clickhouse';
import { describeError } from '@beefy/config';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import { isAddress, staticBlocked } from '../http/address.ts';
import { BreakerOpenError } from '../http/breaker.ts';
import { OverloadedError } from '../http/limiter.ts';
import type { Metrics } from '../http/metrics.ts';
import { log } from '../lib/log.ts';
import { TimelineTooLargeError } from '../timeline/repository.ts';
import { MissRateLimitedError, type TimelineService } from '../timeline/service.ts';

const ItemSchema = z
    .object({
        type: z.enum(['classic', 'clm']),
        datetime: z.string().openapi({ example: '2026-10-20T12:00:19.000Z' }),
        timestamp: z.number().int().openapi({ description: 'Unix seconds' }),
        block_number: z.number().int(),
        transaction_hash: z.string(),
        chain: z.string().openapi({ example: 'base', description: 'Beefy chain key' }),
        chain_id: z.number().int(),
        product_address: z.string().openapi({ description: 'Vault or CLM manager address, lower case' }),
        actions: z.array(z.string()).openapi({
            description:
                'deposit and withdraw (shares minted from or burned to the zero address, and CLM events), stake and unstake (boosts), claim, transfer_in and transfer_out (shares moved between accounts). A deposit or withdrawal through a zap or router is recognised when the router mints or burns exactly the amount it forwards or receives.',
        }),
        share_balance: z
            .string()
            .openapi({ description: 'Shares held across the product after this transaction, in whole shares' }),
        share_diff: z.string(),
        contracts: z.array(z.object({ address: z.string(), kind: z.string(), balance: z.string(), diff: z.string() })),
        price: z.object({
            share_to_usd: z.number(),
            flag: z.enum(timelinePriceFlags()).openapi({
                description:
                    'OK is interpolated between two 5 minute prices at most 6 hours apart; STALE between prices further apart (each within 48 hours); EXTRAPOLATED carried flat from the one price within 48 hours; MISSING no price (USD 0). Newer than about a day the price is provisional and replaced later: PROVISIONAL is the latest Beefy API price the indexer had (source indexer); PENDING not priced yet (USD 0, for at most a few minutes)',
            }),
            source: z.string().openapi({
                description: 'The 5 minute price source, indexer for the indexer price, empty when MISSING or PENDING',
            }),
            resolution: z.enum(timelinePriceResolutions()).nullable().openapi({
                description:
                    '5m for prices from the 5 minute table; latest for the indexer price; null when MISSING or PENDING',
            }),
            as_of: z.string().nullable().openapi({ description: 'The last price at or before the event' }),
            as_of_next: z.string().nullable().openapi({ description: 'The first price at or after the event' }),
        }),
        usd_balance: z.number(),
        usd_diff: z.number(),
        underlying: z.object({ amount0: z.string(), amount1: z.string() }).optional().openapi({
            description: 'CLM deposits and withdrawals: signed amounts in the smallest unit of token0 and token1',
        }),
        claims: z.array(
            z.object({
                contract: z.string(),
                token: z.string().nullable(),
                amount: z.string().openapi({ description: 'Smallest unit of the reward token' }),
                usd: z.number().nullable(),
            })
        ),
    })
    .openapi('TimelineItem');

const ADDRESS_PATTERN = '^0x[0-9a-fA-F]{40}$';

const timelineRoute = createRoute({
    method: 'get',
    path: '/v1/users/{address}/timeline',
    tags: ['users'],
    summary: 'Every priced event of a user, newest first',
    description:
        'One item per transaction and product, the user’s whole history in one response. There are no parameters: the response is cached by the full URL, so any query string is redirected away.',
    request: { params: z.object({ address: z.string().regex(new RegExp(ADDRESS_PATTERN)) }) },
    responses: {
        200: {
            description: 'The timeline',
            content: {
                'application/json': {
                    schema: z.object({
                        address: z.string(),
                        generated_at: z.string(),
                        count: z.number().int(),
                        items: z.array(ItemSchema),
                    }),
                },
            },
        },
        308: { description: 'Not the canonical URL (query string or upper case address)' },
        400: { description: 'Not an address' },
        404: { description: 'An address that has no timeline (zero, burn or a Beefy contract)' },
        413: { description: 'The account has more rows than a single response is built from (a bot or an aggregator)' },
        429: { description: 'Too many requests' },
        503: { description: 'Overloaded or the database is unavailable' },
    },
});

const NO_STORE = 'no-store';
/** Redirects are cheap and identical for everyone: let the edge keep them. */
const REDIRECT_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';
/** Answers that only depend on the URL: the edge keeps them and the origin never sees the same one twice a day. */
const NOT_AN_ADDRESS_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400';
/** The list of Beefy's contracts is refreshed hourly. */
const NOT_A_USER_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';
/** Served from an old copy because refreshing failed: ask for another try soon. */
const DEGRADED_CACHE_CONTROL = 'public, max-age=5, s-maxage=5, stale-if-error=3600';

const error = (
    context: Context,
    status: 400 | 404 | 413 | 429 | 503,
    message: string,
    retryAfterSeconds?: number,
    cacheControl = NO_STORE
) => {
    context.header('Cache-Control', cacheControl);
    if (retryAfterSeconds !== undefined) context.header('Retry-After', String(retryAfterSeconds));
    return context.json({ error: { message } }, status);
};

export type TimelineRouteDeps = {
    service: Pick<TimelineService, 'get'>;
    /** Lower case addresses that are not users: refreshed by the caller, read on every request. */
    blocked: () => ReadonlySet<string>;
    metrics?: Metrics;
};

export const registerTimeline = (app: OpenAPIHono, { service, blocked, metrics }: TimelineRouteDeps): void => {
    app.openAPIRegistry.registerPath(timelineRoute);
    const blockedAlways = new Set(staticBlocked());

    app.get('/v1/users/:address/timeline', async (context) => {
        const address = context.req.param('address');
        if (!isAddress(address)) return error(context, 400, 'Not an address', undefined, NOT_AN_ADDRESS_CACHE_CONTROL);

        // The edge keys its cache by the full URL, so every other spelling of this URL must lead to one canonical URL
        // without costing a query: cache busting and upper case addresses end here.
        const url = new URL(context.req.url);
        const canonical = address.toLowerCase();
        if (url.search !== '' || address !== canonical) {
            context.header('Cache-Control', REDIRECT_CACHE_CONTROL);
            return context.redirect(`/v1/users/${canonical}/timeline`, 308);
        }

        if (blockedAlways.has(canonical) || blocked().has(canonical)) {
            return error(context, 404, 'No timeline for this address', undefined, NOT_A_USER_CACHE_CONTROL);
        }

        try {
            const { response, cache } = await service.get(canonical, context.get('clientKey'));
            metrics?.increment('beefy_timeline_requests_total', { result: cache.toLowerCase().replace('-', '_') });
            context.header('X-Cache', cache);
            context.header('ETag', response.etag);
            context.header('Cache-Control', cache === 'ERROR-STALE' ? DEGRADED_CACHE_CONTROL : response.cacheControl);
            context.header('Content-Type', 'application/json; charset=UTF-8');
            context.header('Vary', 'Accept-Encoding');
            if (context.req.header('If-None-Match') === response.etag) return context.body(null, 304);
            if (/\bgzip\b/.test(context.req.header('Accept-Encoding') ?? '')) {
                context.header('Content-Encoding', 'gzip');
                // a view over the cached bytes: a hit must not copy a response that can be megabytes (zlib output is never shared memory)
                const { buffer, byteOffset, length } = response.gzip;
                return context.body(new Uint8Array(buffer as ArrayBuffer, byteOffset, length), 200);
            }
            return context.body(response.body, 200);
        } catch (failure) {
            if (failure instanceof TimelineTooLargeError) {
                metrics?.increment('beefy_timeline_requests_total', { result: 'too_large' });
                // the answer is the same for everyone for a while: let the edge keep it
                return error(
                    context,
                    413,
                    `Timeline has more than ${failure.maxRows} rows`,
                    undefined,
                    'public, s-maxage=300'
                );
            }
            if (failure instanceof MissRateLimitedError) {
                metrics?.increment('beefy_rate_limited_total', { kind: 'uncached' });
                return error(context, 429, 'Too many requests', failure.retryAfterSeconds);
            }
            metrics?.increment('beefy_timeline_requests_total', { result: 'unavailable' });
            // Overloaded, breaker open, or the database failing or timing out: all the same to a caller, who should retry.
            if (!(failure instanceof OverloadedError || failure instanceof BreakerOpenError)) {
                log.error({
                    event: 'timeline-query-failed',
                    requestId: context.get('requestId'),
                    error: describeError(failure),
                });
            }
            return error(context, 503, 'Temporarily unavailable', 5);
        }
    });
};
