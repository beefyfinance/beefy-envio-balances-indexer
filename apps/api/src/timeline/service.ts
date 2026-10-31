import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { createCircuitBreaker } from '../http/breaker.ts';
import { createConcurrencyLimiter, OverloadedError } from '../http/limiter.ts';
import { createByteLru } from '../http/lru.ts';
import { createRateLimiter } from '../http/rateLimit.ts';
import { createSingleFlight } from '../http/singleFlight.ts';
import { buildTimeline } from './build.ts';
import { type TimelineRepository, TimelineTooLargeError } from './repository.ts';

const gzipAsync = promisify(gzip);

export type TimelineResponse = {
    body: string;
    /** The same body, compressed once when it is built: a hit never compresses. */
    gzip: Buffer;
    etag: string;
    cacheControl: string;
    items: number;
};

export type TimelineServiceOptions = {
    repository: TimelineRepository;
    cacheBytes: number;
    /** ClickHouse queries (cache misses) per minute, for all clients together, and the burst allowed. */
    missesPerMinute: number;
    missBurst: number;
    /**
     * The same per client, so one client cannot spend everyone's budget with addresses nobody else asks for (each is a
     * miss). Checked before the global limit, so a refused client takes nothing from it.
     */
    clientMissesPerMinute: number;
    clientMissBurst: number;
    maxInFlight: number;
    maxQueue: number;
    maxQueueWaitMs: number;
    /**
     * The active deployment version, part of every cache key: after a switch the entries of the old version are never
     * served again (they age out of the LRU). Read on every request, so it must be cheap (a value refreshed elsewhere).
     * Undefined while unknown.
     */
    version?: () => number | undefined;
    now?: () => number;
    random?: () => number;
};

export class MissRateLimitedError extends Error {
    readonly retryAfterSeconds: number;
    constructor(retryAfterSeconds: number) {
        super('too many uncached requests');
        this.name = 'MissRateLimitedError';
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

/** A user with an event this recent is likely to have another soon: short lifetimes. */
const ACTIVE_WINDOW_MS = 2 * 3600 * 1000;
const JITTER = 0.2;

/** What Cloudflare and browsers are told (the doc's table). */
const CACHE_CONTROL = {
    active: 'public, max-age=5, s-maxage=5, stale-while-revalidate=5, stale-if-error=3600',
    idle: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400',
    empty: 'public, s-maxage=60, stale-while-revalidate=300',
};

/** The origin's own freshness is a little shorter than the edge's, and jittered so popular keys do not expire together. */
const ORIGIN_FRESH_MS = { active: 4_000, idle: 45_000, empty: 45_000 };
// none for an active user: a stale answer delays their new event, and its refresh would escape the miss budgets
const ORIGIN_STALE_MS = { active: 0, idle: 60_000, empty: 60_000 };
const ORIGIN_ERROR_MS = 3600_000;

/** Accounts found too large are remembered for a while, so asking again costs nothing. */
const TOO_LARGE_MS = 5 * 60_000;
const TOO_LARGE_MAX_ENTRIES = 10_000;

export type TimelineLookup = { response: TimelineResponse; cache: 'HIT' | 'MISS' | 'STALE' | 'ERROR-STALE' };

export const createTimelineService = ({
    repository,
    cacheBytes,
    missesPerMinute,
    missBurst,
    clientMissesPerMinute,
    clientMissBurst,
    maxInFlight,
    maxQueue,
    maxQueueWaitMs,
    version = () => undefined,
    now = Date.now,
    random = Math.random,
}: TimelineServiceOptions) => {
    const cache = createByteLru<TimelineResponse>(cacheBytes, now);
    const flight = createSingleFlight<TimelineResponse>();
    const misses = createRateLimiter({ ratePerMinute: missesPerMinute, burst: missBurst, maxKeys: 1, now });
    const clientMisses = createRateLimiter({ ratePerMinute: clientMissesPerMinute, burst: clientMissBurst, now });
    const limiter = createConcurrencyLimiter({ maxInFlight, maxQueue, maxWaitMs: maxQueueWaitMs });
    // only the database failing or timing out opens it: a too large account or a full queue says nothing about its health
    const breaker = createCircuitBreaker({
        failureThreshold: 5,
        openMs: 10_000,
        isFailure: (error) => !(error instanceof TimelineTooLargeError || error instanceof OverloadedError),
        now,
    });

    const tooLarge = new Map<string, { until: number; error: TimelineTooLargeError }>();

    const keyOf = (address: string): string => `${version() ?? '?'}:${address}`;

    const build = async (key: string, address: string): Promise<TimelineResponse> => {
        const rows = await breaker
            .run(() => limiter.run(() => repository.rows(address)))
            .catch((error: unknown) => {
                if (error instanceof TimelineTooLargeError) {
                    if (tooLarge.size >= TOO_LARGE_MAX_ENTRIES) tooLarge.delete(tooLarge.keys().next().value ?? '');
                    tooLarge.set(key, { until: now() + TOO_LARGE_MS, error });
                }
                throw error;
            });
        const items = buildTimeline(rows);
        const newest = items[0]?.timestamp;
        const active = newest !== undefined && now() - newest * 1000 < ACTIVE_WINDOW_MS;
        const kind = items.length === 0 ? 'empty' : active ? 'active' : 'idle';
        // the tag covers the data only, not generated_at, so an unchanged timeline revalidates with a 304
        const etag = `"${createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 32)}"`;
        const body = JSON.stringify({
            address,
            generated_at: new Date(now()).toISOString(),
            count: items.length,
            items,
        });
        const compressed = await gzipAsync(body);
        const response: TimelineResponse = {
            body,
            gzip: compressed,
            etag,
            cacheControl: CACHE_CONTROL[kind],
            items: items.length,
        };
        const jitter = 1 + (random() * 2 - 1) * JITTER;
        cache.set(key, response, body.length + compressed.length, {
            freshMs: ORIGIN_FRESH_MS[kind] * jitter,
            staleMs: ORIGIN_STALE_MS[kind],
            errorMs: ORIGIN_ERROR_MS,
        });
        return response;
    };

    const refresh = (key: string, address: string): Promise<TimelineResponse> =>
        flight.run(key, () => build(key, address));

    return {
        /**
         * Fresh from memory; stale from memory while one refresh runs in the background; otherwise one shared query,
         * limited per client (`client`, the rate limit key) and globally, queued, and guarded by the breaker. If that
         * fails and an old copy exists, the old copy.
         */
        async get(address: string, client = 'unknown'): Promise<TimelineLookup> {
            const key = keyOf(address);
            const refused = tooLarge.get(key);
            if (refused !== undefined) {
                if (refused.until > now()) throw refused.error;
                tooLarge.delete(key);
            }
            const hit = cache.get(key);
            if (hit?.state === 'fresh') return { response: hit.value, cache: 'HIT' };
            if (hit?.state === 'stale') {
                refresh(key, address).catch(() => {});
                return { response: hit.value, cache: 'STALE' };
            }
            try {
                // a request that joins a query already running costs ClickHouse nothing, so it is not counted
                if (!flight.has(key)) {
                    const ownBudget = clientMisses.take(client);
                    if (!ownBudget.allowed) throw new MissRateLimitedError(ownBudget.retryAfterSeconds);
                    const sharedBudget = misses.take('all');
                    if (!sharedBudget.allowed) throw new MissRateLimitedError(sharedBudget.retryAfterSeconds);
                }
                return { response: await refresh(key, address), cache: 'MISS' };
            } catch (error) {
                // an old copy (the `error-only` lifetime) beats an error
                if (hit !== undefined) return { response: hit.value, cache: 'ERROR-STALE' };
                throw error;
            }
        },
        /** The contracts of Beefy products, for the "not a user" check; cheap enough to call hourly. */
        productContracts: () => repository.productContracts(),
        get stats() {
            return { bytes: cache.bytes, entries: cache.size, queued: limiter.queued, inFlight: limiter.inFlight };
        },
    };
};

export type TimelineService = ReturnType<typeof createTimelineService>;
