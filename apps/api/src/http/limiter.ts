export class OverloadedError extends Error {
    constructor() {
        super('too many concurrent database queries');
        this.name = 'OverloadedError';
    }
}

/** At most `maxInFlight` runs at once; up to `maxQueue` more wait at most `maxWaitMs`; the rest are refused at once. */
export const createConcurrencyLimiter = ({
    maxInFlight,
    maxQueue,
    maxWaitMs,
}: {
    maxInFlight: number;
    maxQueue: number;
    maxWaitMs: number;
}) => {
    let active = 0;
    const waiting: { start: () => void; timer: ReturnType<typeof setTimeout> }[] = [];

    const next = (): void => {
        const waiter = waiting.shift();
        if (waiter !== undefined) {
            clearTimeout(waiter.timer);
            waiter.start();
        }
    };

    const acquire = (): Promise<void> => {
        if (active < maxInFlight) {
            active += 1;
            return Promise.resolve();
        }
        if (waiting.length >= maxQueue) return Promise.reject(new OverloadedError());
        return new Promise<void>((resolve, reject) => {
            const waiter = {
                start: () => {
                    active += 1;
                    resolve();
                },
                timer: setTimeout(() => {
                    waiting.splice(waiting.indexOf(waiter), 1);
                    reject(new OverloadedError());
                }, maxWaitMs),
            };
            waiting.push(waiter);
        });
    };

    return {
        async run<V>(fn: () => Promise<V>): Promise<V> {
            await acquire();
            try {
                return await fn();
            } finally {
                active -= 1;
                next();
            }
        },
        get inFlight(): number {
            return active;
        },
        get queued(): number {
            return waiting.length;
        },
    };
};
