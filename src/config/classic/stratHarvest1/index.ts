import type { EvmChainId } from 'envio';
import { type Bytes, bytesIncludes } from '../../../lib/hex';
import { CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN } from './chains';

export { CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN };

export const getClassicStratHarvest1ForAddresses = (chainId: EvmChainId): readonly Bytes[] =>
    CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN[chainId] ?? [];

export const usesClassicStratHarvest1Abi = (chainId: EvmChainId, strategyAddress: Bytes): boolean =>
    bytesIncludes(getClassicStratHarvest1ForAddresses(chainId), strategyAddress);
