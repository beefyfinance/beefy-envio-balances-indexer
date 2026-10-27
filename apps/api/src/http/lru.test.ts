import { describe, expect, it } from 'vitest';

import { createByteLru } from './lru.ts';

const lifetimes = { freshMs: 10, staleMs: 20, errorMs: 100 };

describe('byte LRU', () => {
    it('moves an entry through fresh, stale and error-only before forgetting it', () => {
        let time = 0;
        const cache = createByteLru<string>(1000, () => time);
        cache.set('a', 'value', 10, lifetimes);
        expect(cache.get('a')).toEqual({ value: 'value', state: 'fresh' });
        time = 10;
        expect(cache.get('a')?.state).toBe('stale');
        time = 30;
        expect(cache.get('a')?.state).toBe('error-only');
        time = 130;
        expect(cache.get('a')).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    it('evicts the least recently used entries when over the byte budget', () => {
        const cache = createByteLru<string>(30);
        cache.set('a', 'a', 10, lifetimes);
        cache.set('b', 'b', 10, lifetimes);
        cache.set('c', 'c', 10, lifetimes);
        cache.get('a');
        cache.set('d', 'd', 10, lifetimes);
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')).toBeDefined();
        expect(cache.bytes).toBe(30);
    });

    it('replaces an entry without double counting and refuses one larger than the cache', () => {
        const cache = createByteLru<string>(30);
        cache.set('a', 'x', 20, lifetimes);
        cache.set('a', 'y', 25, lifetimes);
        expect(cache.bytes).toBe(25);
        cache.set('big', 'z', 31, lifetimes);
        expect(cache.get('big')).toBeUndefined();
        expect(cache.get('a')?.value).toBe('y');
    });
});
