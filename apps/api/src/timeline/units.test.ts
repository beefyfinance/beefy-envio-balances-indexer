import { describe, expect, it } from 'vitest';

import { formatUnits } from './units.ts';

describe('formatUnits', () => {
    it('formats exactly, trimming trailing zeros', () => {
        expect(formatUnits(1_500_000_000_000_000_000n, 18)).toBe('1.5');
        expect(formatUnits(1n, 18)).toBe('0.000000000000000001');
        expect(formatUnits(0n, 18)).toBe('0');
        expect(formatUnits(123n, 0)).toBe('123');
        expect(formatUnits(2_000_000n, 6)).toBe('2');
    });

    it('keeps the sign and does not lose precision beyond 2^53', () => {
        expect(formatUnits(-9_060_980_804_197_412_061n, 18)).toBe('-9.060980804197412061');
        expect(formatUnits(123_456_789_012_345_678_901_234_567_890n, 18)).toBe('123456789012.34567890123456789');
    });
});
