import type { EvmChainId } from 'envio';

import { asHex } from '../../../lib/hex';
import { CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN } from './chains';

const getClassicStratHarvest1ForAddresses = (chainId: EvmChainId): readonly string[] =>
    CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN[chainId] ?? [];

export const usesClassicStratHarvest1Abi = (chainId: EvmChainId, strategyAddress: string): boolean =>
    getClassicStratHarvest1ForAddresses(chainId).some((address) => asHex(address) === asHex(strategyAddress));
