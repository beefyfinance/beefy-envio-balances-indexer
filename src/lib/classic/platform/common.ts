import type { Hex } from 'viem';

export type TokenBalance = {
    tokenAddress: Hex;
    rawBalance: bigint;
};
