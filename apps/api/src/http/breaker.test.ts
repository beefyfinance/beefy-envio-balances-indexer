import { describe, expect, it } from 'vitest';

import { BreakerOpenError, createCircuitBreaker } from './breaker.ts';

const fail = (): Promise<never> => Promise.reject(new Error('down'));

describe('circuit breaker', () => {
    it('opens after consecutive failures, refuses calls, then probes once and closes on success', async () => {
        let time = 0;
        const breaker = createCircuitBreaker({ failureThreshold: 2, openMs: 100, now: () => time });
        await expect(breaker.run(fail)).rejects.toThrow('down');
        await expect(breaker.run(() => Promise.resolve(1))).resolves.toBe(1);
        await expect(breaker.run(fail)).rejects.toThrow('down');
        await expect(breaker.run(fail)).rejects.toThrow('down');
        expect(breaker.state).toBe('open');
        await expect(breaker.run(() => Promise.resolve(1))).rejects.toBeInstanceOf(BreakerOpenError);
        time = 100;
        await expect(breaker.run(() => Promise.resolve(2))).resolves.toBe(2);
        expect(breaker.state).toBe('closed');
    });

    it('opens again when the probe fails', async () => {
        let time = 0;
        const breaker = createCircuitBreaker({ failureThreshold: 1, openMs: 100, now: () => time });
        await expect(breaker.run(fail)).rejects.toThrow('down');
        time = 100;
        await expect(breaker.run(fail)).rejects.toThrow('down');
        await expect(breaker.run(() => Promise.resolve(1))).rejects.toBeInstanceOf(BreakerOpenError);
        time = 200;
        await expect(breaker.run(() => Promise.resolve(3))).resolves.toBe(3);
    });

    it('passes on the errors that are not failures without counting them', async () => {
        const breaker = createCircuitBreaker({
            failureThreshold: 1,
            openMs: 100,
            isFailure: (error) => !(error instanceof RangeError),
            now: () => 0,
        });
        for (let i = 0; i < 3; i += 1) {
            await expect(breaker.run(() => Promise.reject(new RangeError('too large')))).rejects.toThrow('too large');
        }
        expect(breaker.state).toBe('closed');
        await expect(breaker.run(fail)).rejects.toThrow('down');
        expect(breaker.state).toBe('open');
    });
});
