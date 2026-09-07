import { describe, expect, it } from 'vitest';
import { decodeEffectInput, encodeEffectOutput } from './effect';
import { toBytes, toHex, ZERO_ADDRESS } from './hex';

const ADDRESS = '0xc55e93c62874d8100dbd2dfe307edc1036ad5434';
const CHECKSUM = '0xC55E93C62874d8100dBd2dFE307EdC1036Ad5434';

describe('effect IO', () => {
    it('Should decode hex address fields to bytes and leave other fields alone', () => {
        const decoded = decodeEffectInput({
            chainId: 56,
            vaultAddress: CHECKSUM,
            underlyingPlatform: 'AAVE',
            rewardPoolTokenAddresses: [ADDRESS],
            token: { address: ADDRESS, decimals: 18 },
        });

        expect(decoded.chainId).toBe(56);
        expect(decoded.underlyingPlatform).toBe('AAVE');
        expect(decoded.token.decimals).toBe(18);
        expect(decoded.vaultAddress).toEqual(toBytes(ADDRESS));
        expect(decoded.rewardPoolTokenAddresses).toEqual([toBytes(ADDRESS)]);
        expect(decoded.token.address).toEqual(toBytes(ADDRESS));
    });

    it('Should encode domain bytes back to lowercase hex', () => {
        const encoded = encodeEffectOutput({
            shareTokenAddress: toBytes(CHECKSUM),
            blacklistStatus: 'ok' as const,
            breakdownTokenAddresses: [ZERO_ADDRESS],
        });

        expect(encoded).toEqual({
            shareTokenAddress: ADDRESS,
            blacklistStatus: 'ok',
            breakdownTokenAddresses: [toHex(ZERO_ADDRESS)],
        });
    });
});
