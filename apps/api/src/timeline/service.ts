import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { createCircuitBreaker } from '../http/breaker.ts';
import { createConcurrencyLimiter } from '../http/limiter.ts';
import { createByteLru } from '../http/lru.ts';
import { createRateLimiter } from '../http/rateLimit.ts';
import { createSingleFlight } from '../http/singleFlight.ts';
import { buildTimeline } from './build.ts';
import type { TimelineRepository } from './repository.ts';

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
    maxInFlight: number;
    maxQueue: number;
    maxQueueWaitMs: number;
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
    active: 'public, max-age=5, s-maxage=15, stale-while-revalidate=60, stale-if-error=3600',
    idle: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400',
    empty: 'public, s-maxage=60, stale-while-revalidate=300',
};

/** The origin's own freshness is a little shorter than the edge's, and jittered so popular keys do not expire together. */
const ORIGIN_FRESH_MS = { active: 10_000, idle: 45_000, empty: 45_000 };
const ORIGIN_STALE_MS = 60_000;
const ORIGIN_ERROR_MS = 3600_000;

export type TimelineLookup = { response: TimelineResponse; cache: 'HIT' | 'MISS' | 'STALE' | 'ERROR-STALE' };

export const createTimelineService = ({
    repository,
    cacheBytes,
    missesPerMinute,
    missBurst,
    maxInFlight,
    maxQueue,
    maxQueueWaitMs,
    now = Date.now,
    random = Math.random,
}: TimelineServiceOptions) => {
    const cache = createByteLru<TimelineResponse>(cacheBytes, now);
    const flight = createSingleFlight<TimelineResponse>();
    const misses = createRateLimiter({ ratePerMinute: missesPerMinute, burst: missBurst, maxKeys: 1, now });
    const limiter = createConcurrencyLimiter({ maxInFlight, maxQueue, maxWaitMs: maxQueueWaitMs });
    const breaker = createCircuitBreaker({ failureThreshold: 5, openMs: 10_000, now });

    const build = async (address: string): Promise<TimelineResponse> => {
        const rows = await breaker.run(() => limiter.run(() => repository.rows(address)));
        const items = buildTimeline(rows);
        const newest = items[0]?.timestamp;
        const active = newest !== undefined && now() - newest * 1000 < ACTIVE_WINDOW_MS;
        const kind = items.length === 0 ? 'empty' : active ? 'active' : 'idle';
        // the tag covers the data only, not generated_at, so an unchanged timeline revalidates with a 304
        const itemsJson = JSON.stringify(items);
        const etag = `"${createHash('sha256').update(itemsJson).digest('hex').slice(0, 32)}"`;
        const body = `{"address":"${address}","generated_at":"${new Date(now()).toISOString()}","count":${items.length},"items":${itemsJson}}`;
        const compressed = await gzipAsync(body);
        const response: TimelineResponse = {
            body,
            gzip: compressed,
            etag,
            cacheControl: CACHE_CONTROL[kind],
            items: items.length,
        };
        const jitter = 1 + (random() * 2 - 1) * JITTER;
        cache.set(address, response, body.length + compressed.length, {
            freshMs: ORIGIN_FRESH_MS[kind] * jitter,
            staleMs: ORIGIN_STALE_MS,
            errorMs: ORIGIN_ERROR_MS,
        });
        return response;
    };

    const refresh = (address: string): Promise<TimelineResponse> => flight.run(address, () => build(address));

    return {
        /**
         * Fresh from memory; stale from memory while one refresh runs in the background; otherwise one shared query,
         * limited globally, queued, and guarded by the breaker. If that fails and an old copy exists, the old copy.
         */
        async get(address: string): Promise<TimelineLookup> {
            const hit = cache.get(address);
            if (hit?.state === 'fresh') return { response: hit.value, cache: 'HIT' };
            if (hit?.state === 'stale') {
                refresh(address).catch(() => {});
                return { response: hit.value, cache: 'STALE' };
            }
            try {
                // a request that joins a query already running costs ClickHouse nothing, so it is not counted
                if (!flight.has(address)) {
                    const allowed = misses.take('all');
                    if (!allowed.allowed) throw new MissRateLimitedError(allowed.retryAfterSeconds);
                }
                return { response: await refresh(address), cache: 'MISS' };
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
