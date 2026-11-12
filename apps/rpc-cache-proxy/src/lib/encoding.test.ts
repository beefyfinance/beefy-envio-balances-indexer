import { describe, expect, it } from 'vitest';

import { hex, num, quantity, sha, to0x } from './encoding.ts';

describe('encoding', () => {
    it('stores hex without its prefix, lowercase', () => {
        expect(hex('0xABcd')).toBe('abcd');
    });

    it('reads and writes quantities', () => {
        expect(num('0x1f')).toBe(31);
        expect(quantity(31)).toBe('0x1f');
        expect(quantity(0n)).toBe('0x0');
    });

    it('turns bytea back into 0x hex', () => {
        expect(to0x(Buffer.from('abcd', 'hex'))).toBe('0xabcd');
        expect(to0x(null)).toBeNull();
    });

    it('hashes the same text to the same key', () => {
        expect(sha('a')).toBe(sha('a'));
        expect(sha('a')).not.toBe(sha('b'));
        expect(sha('a')).toHaveLength(64);
    });
});
