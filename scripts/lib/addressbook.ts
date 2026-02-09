import { addressBook, type Token } from '@beefyfinance/blockchain-addressbook';
import * as R from 'remeda';
import type { Hex } from 'viem';

export const allChainIds = R.keys(addressBook);
export type BeefyChainId = (typeof allChainIds)[number];

export const getTokenAddressBySymbol = (chainId: BeefyChainId, symbol: string): Hex | null => {
    return (addressBook[chainId]?.tokens[symbol]?.address as Hex) || null;
};

export const getTokenConfigBySymbol = (chainId: BeefyChainId, symbol: string): Token | null => {
    return addressBook[chainId]?.tokens[symbol] ?? null;
};

export const getWNativeToken = (chainId: BeefyChainId): Token => {
    const token = addressBook[chainId]?.tokens.WNATIVE;
    if (!token) {
        throw new Error(`WNATIVE token is not available on chain ${chainId}`);
    }
    return token;
};

export const getNativeTokenSymbol = (chainId: BeefyChainId): string => {
    return addressBook[chainId]?.native.symbol;
};

export const isNativeToken = (chainId: BeefyChainId, symbol: string) => {
    if (symbol === getNativeTokenSymbol(chainId)) {
        return true;
    }

    const wnative = getWNativeToken(chainId);
    return `W${symbol}` === wnative.symbol || symbol === 'ETH';
};
