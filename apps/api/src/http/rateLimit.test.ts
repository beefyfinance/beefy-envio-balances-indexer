import { describe, expect, it } from 'vitest';

import { createRateLimiter } from './rateLimit.ts';

describe('rate limiter', () => {
    it('allows a burst, then the sustained rate, and says when to come back', () => {
        let time = 0;
        const limiter = createRateLimiter({ ratePerMinute: 60, burst: 3, now: () => time });
        expect([1, 2, 3].map(() => limiter.take('ip').allowed)).toEqual([true, true, true]);
        expect(limiter.take('ip')).toEqual({ allowed: false, retryAfterSeconds: 1 });
        time = 1000;
        expect(limiter.take('ip').allowed).toBe(true);
        expect(limiter.take('ip').allowed).toBe(false);
    });

    it('keeps clients apart and never refills past the burst', () => {
        let time = 0;
        const limiter = createRateLimiter({ ratePerMinute: 60, burst: 2, now: () => time });
        limiter.take('a');
        limiter.take('a');
        expect(limiter.take('a').allowed).toBe(false);
        expect(limiter.take('b').allowed).toBe(true);
        time = 3_600_000;
        expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, false]);
    });

    it('does not grow without bound under a flood of distinct keys', () => {
        const limiter = createRateLimiter({ ratePerMinute: 60, burst: 5, maxKeys: 100 });
        for (let i = 0; i < 10_000; i += 1) limiter.take(`ip-${i}`);
        expect(limiter.size).toBeLessThanOrEqual(100);
    });
});
