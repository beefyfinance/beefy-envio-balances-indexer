import type { EvmChainId } from 'envio';
import type { Hex } from 'viem';
import { normalizeHex } from '../../../lib/hex';
import { CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN } from './chains';

export { CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN };

export const getClassicStratHarvest1ForAddresses = (chainId: EvmChainId): readonly Hex[] =>
    CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN[chainId] ?? [];

export const usesClassicStratHarvest1Abi = (chainId: EvmChainId, strategyAddress: Hex): boolean =>
    getClassicStratHarvest1ForAddresses(chainId).some(
        (address) => normalizeHex(address) === normalizeHex(strategyAddress)
    );
