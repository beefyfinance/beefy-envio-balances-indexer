import { describe, expect, it } from 'vitest';

import { createConcurrencyLimiter, OverloadedError } from './limiter.ts';

const deferred = () => {
    let release = (): void => {};
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { promise, release };
};

describe('concurrency limiter', () => {
    it('runs up to the limit, queues the next, and refuses beyond the queue', async () => {
        const limiter = createConcurrencyLimiter({ maxInFlight: 1, maxQueue: 1, maxWaitMs: 1000 });
        const first = deferred();
        const running = limiter.run(() => first.promise);
        const queued = limiter.run(() => Promise.resolve('second'));
        expect(limiter.inFlight).toBe(1);
        expect(limiter.queued).toBe(1);
        await expect(limiter.run(() => Promise.resolve('third'))).rejects.toBeInstanceOf(OverloadedError);
        first.release();
        await running;
        expect(await queued).toBe('second');
        expect(limiter.inFlight).toBe(0);
    });

    it('gives up on a queued call after the maximum wait', async () => {
        const limiter = createConcurrencyLimiter({ maxInFlight: 1, maxQueue: 5, maxWaitMs: 10 });
        const first = deferred();
        const running = limiter.run(() => first.promise);
        await expect(limiter.run(() => Promise.resolve())).rejects.toBeInstanceOf(OverloadedError);
        expect(limiter.queued).toBe(0);
        first.release();
        await running;
    });

    it('frees its slot when a run fails', async () => {
        const limiter = createConcurrencyLimiter({ maxInFlight: 1, maxQueue: 0, maxWaitMs: 10 });
        await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
        expect(await limiter.run(() => Promise.resolve('ok'))).toBe('ok');
    });
});
