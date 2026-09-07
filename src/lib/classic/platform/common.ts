import type { Bytes } from '../../hex';
export type TokenBalance = {
    tokenAddress: Bytes;
    rawBalance: bigint;
};
