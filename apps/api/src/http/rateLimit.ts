export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * A token bucket per key, in memory. `ratePerMinute` tokens are added per minute up to `burst`. Keys that have been idle
 * long enough to be full again are forgotten, and the table is capped so a flood of distinct keys cannot grow it.
 */
export const createRateLimiter = ({
    ratePerMinute,
    burst,
    maxKeys = 100_000,
    now = Date.now,
}: {
    ratePerMinute: number;
    burst: number;
    maxKeys?: number;
    now?: () => number;
}) => {
    const perMs = ratePerMinute / 60_000;
    const buckets = new Map<string, { tokens: number; at: number }>();

    const refill = (bucket: { tokens: number; at: number }, time: number): void => {
        bucket.tokens = Math.min(burst, bucket.tokens + (time - bucket.at) * perMs);
        bucket.at = time;
    };

    return {
        take(key: string): RateLimitResult {
            const time = now();
            let bucket = buckets.get(key);
            if (bucket === undefined) {
                if (buckets.size >= maxKeys) {
                    // forget the keys that are full again, and if none is, the oldest
                    for (const [other, state] of buckets) {
                        refill(state, time);
                        if (state.tokens >= burst) buckets.delete(other);
                    }
                    if (buckets.size >= maxKeys) {
                        const oldest = buckets.keys().next();
                        if (!oldest.done) buckets.delete(oldest.value);
                    }
                }
                bucket = { tokens: burst, at: time };
                buckets.set(key, bucket);
            } else {
                refill(bucket, time);
            }
            if (bucket.tokens >= 1) {
                bucket.tokens -= 1;
                return { allowed: true };
            }
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / perMs / 1000)) };
        },
        get size(): number {
            return buckets.size;
        },
    };
};
