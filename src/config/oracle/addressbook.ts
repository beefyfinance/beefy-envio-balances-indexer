import { addressBookByChainId } from '@beefyfinance/blockchain-addressbook';
import type { EvmChainId } from 'envio';
import { type Bytes, toBytes } from '../../lib/hex';

const getChain = (chainId: EvmChainId) => {
    const chain = addressBookByChainId[String(chainId) as keyof typeof addressBookByChainId];
    if (!chain) {
        throw new Error(`No addressbook entry for chain ${chainId}`);
    }
    return chain;
};

export const getWrappedNativeAddress = (chainId: EvmChainId): Bytes => {
    const address = getChain(chainId).tokens.WNATIVE?.address;
    if (!address) {
        throw new Error(`Addressbook missing tokens.WNATIVE.address for chain ${chainId}`);
    }
    return toBytes(address);
};

export const getWrappedNativeDecimals = (chainId: EvmChainId): number => {
    return getChain(chainId).tokens.WNATIVE.decimals;
};

export const getBeefySwapperAddress = (chainId: EvmChainId): Bytes => {
    const address = getChain(chainId).platforms.beefyfinance?.beefySwapper;
    if (!address) {
        throw new Error(`Addressbook missing platforms.beefyfinance.beefySwapper for chain ${chainId}`);
    }
    return toBytes(address);
};

export const getBeefyOracleAddress = (chainId: EvmChainId): Bytes => {
    const address = getChain(chainId).platforms.beefyfinance?.beefyOracle;
    if (!address) {
        throw new Error(`Addressbook missing platforms.beefyfinance.beefyOracle for chain ${chainId}`);
    }
    return toBytes(address);
};
