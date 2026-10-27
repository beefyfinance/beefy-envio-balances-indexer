/** Concurrent calls with the same key share one run of `fn`; the key is free again as soon as it settles. */
export const createSingleFlight = <V>() => {
    const running = new Map<string, Promise<V>>();
    return {
        run(key: string, fn: () => Promise<V>): Promise<V> {
            const existing = running.get(key);
            if (existing !== undefined) return existing;
            const promise = fn().finally(() => running.delete(key));
            running.set(key, promise);
            return promise;
        },
        has(key: string): boolean {
            return running.has(key);
        },
        get inFlight(): number {
            return running.size;
        },
    };
};
