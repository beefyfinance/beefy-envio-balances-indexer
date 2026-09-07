import { describe, expect, it } from 'vitest';
import { asHex, bytesEqual, bytesIncludes, isZeroAddress, toBytes, toHex, ZERO_ADDRESS } from './hex';

const ADDRESS = '0xc55e93c62874d8100dbd2dfe307edc1036ad5434';
const CHECKSUM = '0xC55E93C62874d8100dBd2dFE307EdC1036Ad5434';

describe('hex', () => {
    it('Should decode checksum hex strings to the same bytes', () => {
        expect(toBytes(CHECKSUM)).toEqual(toBytes(ADDRESS));
        expect(toHex(toBytes(CHECKSUM))).toBe(ADDRESS);
        expect(asHex(CHECKSUM)).toBe(ADDRESS);
    });

    it('Should detect the zero address', () => {
        expect(isZeroAddress(ZERO_ADDRESS)).toBe(true);
        expect(isZeroAddress(toBytes('0x0000000000000000000000000000000000000000'))).toBe(true);
        expect(isZeroAddress(toBytes(CHECKSUM))).toBe(false);
    });

    it('Should compare bytes independently of hex casing', () => {
        expect(bytesEqual(toBytes(ADDRESS), toBytes(CHECKSUM))).toBe(true);
        expect(bytesEqual(toBytes(ADDRESS), ZERO_ADDRESS)).toBe(false);
        expect(bytesIncludes([toBytes(CHECKSUM)], toBytes(ADDRESS))).toBe(true);
        expect(bytesIncludes([ZERO_ADDRESS], toBytes(ADDRESS))).toBe(false);
    });
});
