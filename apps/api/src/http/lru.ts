export type CacheState = 'fresh' | 'stale' | 'error-only';

export type CacheHit<V> = { value: V; state: CacheState };

type Entry<V> = { value: V; bytes: number; freshUntil: number; staleUntil: number; errorUntil: number };

/**
 * A cache bounded by bytes, least recently used first out. An entry has three lifetimes:
 * `fresh` (served as is), `stale` (served while one refresh runs: stale-while-revalidate) and `error-only` (served only
 * when refreshing failed: stale-if-error). Past the last one it is gone.
 */
export const createByteLru = <V>(maxBytes: number, now: () => number = Date.now) => {
    const entries = new Map<string, Entry<V>>();
    let used = 0;

    const drop = (key: string): void => {
        const entry = entries.get(key);
        if (entry !== undefined) {
            used -= entry.bytes;
            entries.delete(key);
        }
    };

    return {
        get(key: string): CacheHit<V> | undefined {
            const entry = entries.get(key);
            if (entry === undefined) return undefined;
            const time = now();
            if (time >= entry.errorUntil) {
                drop(key);
                return undefined;
            }
            // re-insert to mark it recently used
            entries.delete(key);
            entries.set(key, entry);
            if (time < entry.freshUntil) return { value: entry.value, state: 'fresh' };
            if (time < entry.staleUntil) return { value: entry.value, state: 'stale' };
            return { value: entry.value, state: 'error-only' };
        },
        set(
            key: string,
            value: V,
            bytes: number,
            lifetimes: { freshMs: number; staleMs: number; errorMs: number }
        ): void {
            drop(key);
            // one entry larger than the whole cache is not worth evicting everything for
            if (bytes > maxBytes) return;
            const time = now();
            const freshUntil = time + lifetimes.freshMs;
            const staleUntil = freshUntil + lifetimes.staleMs;
            entries.set(key, { value, bytes, freshUntil, staleUntil, errorUntil: staleUntil + lifetimes.errorMs });
            used += bytes;
            for (const oldest of entries.keys()) {
                if (used <= maxBytes) break;
                drop(oldest);
            }
        },
        get bytes(): number {
            return used;
        },
        get size(): number {
            return entries.size;
        },
    };
};
