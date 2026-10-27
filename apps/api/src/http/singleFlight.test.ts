import { describe, expect, it } from 'vitest';

import { createSingleFlight } from './singleFlight.ts';

describe('single flight', () => {
    it('shares one run between concurrent callers of a key and releases the key afterwards', async () => {
        const flight = createSingleFlight<number>();
        let runs = 0;
        const slow = async (): Promise<number> => {
            runs += 1;
            const run = runs;
            await new Promise((resolve) => setTimeout(resolve, 5));
            return run;
        };
        const results = await Promise.all([flight.run('k', slow), flight.run('k', slow), flight.run('other', slow)]);
        expect(results.slice(0, 2)).toEqual([1, 1]);
        expect(runs).toBe(2);
        expect(flight.inFlight).toBe(0);
        await flight.run('k', slow);
        expect(runs).toBe(3);
    });

    it('shares a failure too, then lets the next call try again', async () => {
        const flight = createSingleFlight<number>();
        let runs = 0;
        const failing = async (): Promise<number> => {
            runs += 1;
            await Promise.resolve();
            throw new Error('boom');
        };
        await expect(Promise.all([flight.run('k', failing), flight.run('k', failing)])).rejects.toThrow('boom');
        expect(runs).toBe(1);
        await expect(flight.run('k', failing)).rejects.toThrow('boom');
        expect(runs).toBe(2);
    });
});
