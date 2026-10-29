export class BreakerOpenError extends Error {
    constructor() {
        super('circuit breaker is open');
        this.name = 'BreakerOpenError';
    }
}

/**
 * Opens after `failureThreshold` consecutive failures and refuses calls for `openMs`; then lets one probe through
 * (half open): a success closes it, a failure opens it again. An error `isFailure` rejects (an answer about the request,
 * or a refusal before the database was reached) is passed on and changes nothing.
 */
export const createCircuitBreaker = ({
    failureThreshold,
    openMs,
    isFailure = () => true,
    now = Date.now,
}: {
    failureThreshold: number;
    openMs: number;
    isFailure?: (error: unknown) => boolean;
    now?: () => number;
}) => {
    let failures = 0;
    let openedAt: number | undefined;
    let probing = false;

    return {
        async run<V>(fn: () => Promise<V>): Promise<V> {
            if (openedAt !== undefined) {
                if (now() - openedAt < openMs || probing) throw new BreakerOpenError();
                probing = true;
            }
            try {
                const value = await fn();
                failures = 0;
                openedAt = undefined;
                return value;
            } catch (error) {
                if (!isFailure(error)) throw error;
                failures += 1;
                if (openedAt !== undefined || failures >= failureThreshold) openedAt = now();
                throw error;
            } finally {
                probing = false;
            }
        },
        get state(): 'closed' | 'open' {
            return openedAt === undefined ? 'closed' : 'open';
        },
    };
};
