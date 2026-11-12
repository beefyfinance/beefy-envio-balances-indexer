import { describe, expect, it } from 'vitest';

import { gapsOf, rangesOf } from './ranges.ts';

describe('rangesOf', () => {
    it('reads a multirange as inclusive ranges', () => {
        expect(rangesOf('{[1,5),[9,12)}')).toEqual([
            [1, 4],
            [9, 11],
        ]);
    });

    it('reads nothing as no range', () => {
        expect(rangesOf(null)).toEqual([]);
        expect(rangesOf('{}')).toEqual([]);
    });
});

describe('gapsOf', () => {
    it('is the whole range when nothing is covered', () => {
        expect(gapsOf(10, 20, [])).toEqual([[10, 20]]);
    });

    it('is empty when the range is covered', () => {
        expect(gapsOf(10, 20, [[0, 30]])).toEqual([]);
    });

    it('finds the holes between, before and after covered ranges', () => {
        expect(
            gapsOf(10, 50, [
                [20, 29],
                [35, 40],
            ])
        ).toEqual([
            [10, 19],
            [30, 34],
            [41, 50],
        ]);
    });

    it('does not depend on the order of the covered ranges', () => {
        expect(
            gapsOf(0, 9, [
                [6, 7],
                [0, 2],
            ])
        ).toEqual([
            [3, 5],
            [8, 9],
        ]);
    });

    it('stops at the end of the range', () => {
        expect(gapsOf(5, 8, [[0, 6]])).toEqual([[7, 8]]);
    });
});
