import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Job } from './jobs/job.ts';
import { type LogEvent, startScheduler } from './scheduler.ts';

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('scheduler', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const make = (run: Job['run']): Job => ({ name: 'j', intervalMs: 1000, run });

    it('runs a job at start and again an interval after each run finished', async () => {
        const run = vi.fn<Job['run']>(async () => {});
        const scheduler = startScheduler([make(run)], () => {});
        await flush();
        expect(run).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(999);
        expect(run).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(run).toHaveBeenCalledTimes(2);
        await scheduler.stop();
    });

    it('never overlaps a slow run with the next one', async () => {
        let active = 0;
        let peak = 0;
        const run = async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 5000));
            active--;
        };
        const scheduler = startScheduler([make(run)], () => {});
        await vi.advanceTimersByTimeAsync(20_000);
        expect(peak).toBe(1);
        const stopping = scheduler.stop();
        await vi.advanceTimersByTimeAsync(5000); // let the run in flight finish
        await stopping;
    });

    it('logs a failure and keeps going', async () => {
        const events: LogEvent[] = [];
        const run = vi.fn<Job['run']>(async () => {
            throw new Error('boom');
        });
        const scheduler = startScheduler([make(run)], (event) => events.push(event));
        await vi.advanceTimersByTimeAsync(1000);
        expect(run).toHaveBeenCalledTimes(2);
        expect(events.filter((event) => event.event === 'job-failed').map((event) => event.error)).toEqual([
            'boom',
            'boom',
        ]);
        await scheduler.stop();
    });

    it('stop aborts the running job, waits for it and schedules nothing more', async () => {
        let aborted = false;
        const run = vi.fn<Job['run']>(
            (signal: AbortSignal) =>
                new Promise<void>((resolve) => {
                    signal.addEventListener('abort', () => {
                        aborted = true;
                        resolve();
                    });
                })
        );
        const scheduler = startScheduler([make(run)], () => {});
        await flush();
        await scheduler.stop();
        expect(aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(run).toHaveBeenCalledTimes(1);
    });
});
