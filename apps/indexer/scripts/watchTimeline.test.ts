import { describe, expect, it } from 'vitest';

import { type CachedAnswer, createCacheLayer, parseCacheControl, priceInAnswer } from './watchTimeline.ts';

const ACTIVE = 'public, max-age=5, s-maxage=15, stale-while-revalidate=60, stale-if-error=3600';

describe('watch timeline', () => {
    it('reads the lifetimes of Cache-Control', () => {
        expect(parseCacheControl(ACTIVE)).toEqual({ maxAge: 5, sMaxAge: 15, staleWhileRevalidate: 60 });
        expect(parseCacheControl('public, s-maxage=60')).toEqual({ maxAge: 0, sMaxAge: 60, staleWhileRevalidate: 0 });
        expect(parseCacheControl(null)).toEqual({ maxAge: 0, sMaxAge: undefined, staleWhileRevalidate: 0 });
    });

    /** A cache over an upstream that answers `v1`, `v2`, ... and counts its calls; the clock is `clock.now`. */
    const setup = () => {
        const clock = { now: 0 };
        const etags: (string | null)[] = [];
        const layer = createCacheLayer({
            name: 'edge',
            lifetime: ({ maxAge, sMaxAge }) => sMaxAge ?? maxAge,
            now: () => clock.now,
            upstream: async (etag): Promise<CachedAnswer> => {
                etags.push(etag);
                return {
                    etag: `v${etags.length}`,
                    cacheControl: ACTIVE,
                    body: `v${etags.length}`,
                    via: 'origin',
                    age: 0,
                };
            },
        });
        return { clock, etags, layer };
    };

    it('serves fresh, then stale while refreshing, then waits past stale-while-revalidate', async () => {
        const { clock, etags, layer } = setup();
        expect(await layer.get()).toMatchObject({ body: 'v1', via: 'origin' });

        clock.now = 14_000;
        expect(await layer.get()).toMatchObject({ body: 'v1', via: 'edge-fresh' });
        expect(etags).toEqual([null]);

        clock.now = 20_000;
        expect(await layer.get()).toMatchObject({ body: 'v1', via: 'edge-stale' });
        await Promise.resolve();
        expect(etags).toEqual([null, 'v1']);
        expect(await layer.get()).toMatchObject({ body: 'v2', via: 'edge-fresh' });

        clock.now = 200_000;
        expect(await layer.get()).toMatchObject({ body: 'v3', via: 'origin' });
    });

    it('counts the age an upstream reports, as a browser does with Age', async () => {
        const clock = { now: 0 };
        const layer = createCacheLayer({
            name: 'browser',
            lifetime: ({ maxAge }) => maxAge,
            now: () => clock.now,
            upstream: async () => ({ etag: 'v', cacheControl: 'max-age=5', body: 'v', via: 'edge-fresh', age: 3 }),
        });
        await layer.get();
        clock.now = 1_000;
        expect(await layer.get()).toMatchObject({ via: 'browser-fresh', age: 4 });
        clock.now = 2_000;
        expect(await layer.get()).toMatchObject({ via: 'edge-fresh' });
    });

    it('finds the price of a transaction in an API answer', () => {
        const price = { flag: 'PROVISIONAL', share_to_usd: 1.5, source: 'indexer' };
        const body = JSON.stringify({ items: [{ transaction_hash: '0xa', chain_id: 1, price }] });
        expect(priceInAnswer(body, 1, '0xa')).toEqual(price);
        expect(priceInAnswer(body, 2, '0xa')).toBeUndefined();
        expect(priceInAnswer('', 1, '0xa')).toBeUndefined();
    });
});
