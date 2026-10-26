/** A unit of background work, run repeatedly by the scheduler. */
export type Job = {
    /** Unique, stable: used in logs and in `WORKER_JOBS`. */
    name: string;
    /** Delay between the end of one run and the start of the next. */
    intervalMs: number;
    /** Must stop promptly once `signal` aborts (the process is shutting down). */
    run: (signal: AbortSignal) => Promise<void>;
};

export class NotImplementedError extends Error {
    constructor(what: string) {
        super(`${what} is not implemented yet`);
        this.name = 'NotImplementedError';
    }
}
