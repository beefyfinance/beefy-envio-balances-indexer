import { zeroAddress as ZERO_ADDRESS } from 'viem';
import { describe, expect, it } from 'vitest';

import { asHex, isZeroAddress, nonZeroAddress } from './hex';

const ADDRESS = '0xc55e93c62874d8100dbd2dfe307edc1036ad5434';
const CHECKSUM = '0xC55E93C62874d8100dBd2dFE307EdC1036Ad5434';

describe('hex', () => {
    it('lowercases checksum addresses', () => {
        expect(asHex(CHECKSUM)).toBe(ADDRESS);
    });

    it('detects the zero address', () => {
        expect(isZeroAddress(ZERO_ADDRESS)).toBe(true);
        expect(isZeroAddress(CHECKSUM)).toBe(false);
    });

    it('maps zero and missing addresses to undefined', () => {
        expect(nonZeroAddress(undefined)).toBeUndefined();
        expect(nonZeroAddress(ZERO_ADDRESS)).toBeUndefined();
        expect(nonZeroAddress(CHECKSUM)).toBe(ADDRESS);
    });
});
