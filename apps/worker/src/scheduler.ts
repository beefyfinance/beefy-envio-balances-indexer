import type { Job } from './jobs/job.ts';

export type LogEvent = { event: 'job-start' | 'job-done' | 'job-failed'; job: string; ms?: number; error?: string };

export type Scheduler = {
    /** Stops scheduling, aborts the signal handed to running jobs and waits for them to return. */
    stop: () => Promise<void>;
};

/**
 * Runs every job once at start, then again `intervalMs` after each run finished: a slow run delays the next one instead
 * of overlapping it, and a failing run is logged and retried on the next tick, never fatal.
 */
export const startScheduler = (jobs: readonly Job[], log: (event: LogEvent) => void): Scheduler => {
    const controller = new AbortController();
    const timers = new Set<NodeJS.Timeout>();
    const running = new Set<Promise<void>>();

    const loop = (job: Job): void => {
        const started = Date.now();
        log({ event: 'job-start', job: job.name });
        const run = job
            .run(controller.signal)
            .then(() => log({ event: 'job-done', job: job.name, ms: Date.now() - started }))
            .catch((error: unknown) =>
                log({
                    event: 'job-failed',
                    job: job.name,
                    ms: Date.now() - started,
                    error: error instanceof Error ? error.message : String(error),
                })
            )
            .finally(() => {
                running.delete(run);
                if (controller.signal.aborted) return;
                const timer = setTimeout(() => {
                    timers.delete(timer);
                    loop(job);
                }, job.intervalMs);
                timers.add(timer);
            });
        running.add(run);
    };

    for (const job of jobs) loop(job);

    return {
        stop: async () => {
            controller.abort();
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
            await Promise.allSettled(running);
        },
    };
};
