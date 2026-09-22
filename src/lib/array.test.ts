import { describe, expect, it } from 'vitest';
import { applyIndexedDeltas, zeros } from './array';
import { BIG_ONE, BIG_ZERO, BigDecimal } from './decimal';

describe('applyIndexedDeltas', () => {
    it('Should keep prior values when deltas are empty', () => {
        const previous = [BIG_ONE, new BigDecimal(2)];
        expect(applyIndexedDeltas(previous, [], 2).map(String)).toEqual(['1', '2']);
    });

    it('Should pad with zeros up to the target length', () => {
        expect(applyIndexedDeltas([], [], 1).map(String)).toEqual(['0']);
        expect(applyIndexedDeltas([BIG_ONE], [], 2).map(String)).toEqual(['1', '0']);
    });

    it('Should apply sparse deltas without shrinking', () => {
        const previous = [new BigDecimal(5)];
        const deltas = [new BigDecimal(-1), BIG_ONE];
        expect(applyIndexedDeltas(previous, deltas, 2).map(String)).toEqual(['4', '1']);
    });

    it('Should truncate extras when the parent order shrinks', () => {
        expect(applyIndexedDeltas([BIG_ONE, new BigDecimal(2)], [], 1).map(String)).toEqual(['1']);
    });
});

describe('zeros', () => {
    it('Should return a zero-filled vector', () => {
        expect(zeros(0)).toEqual([]);
        expect(zeros(3).every((value) => value.eq(BIG_ZERO))).toBe(true);
        expect(zeros(3)).toHaveLength(3);
    });
});
