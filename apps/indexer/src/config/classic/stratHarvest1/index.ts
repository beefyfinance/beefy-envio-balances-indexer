import type { EvmChainId } from 'envio';

import { asHex } from '../../../lib/hex';
import { classicStratHarvest1Addresses } from './chains';

export const usesClassicStratHarvest1Abi = (chainId: EvmChainId, strategyAddress: string): boolean =>
    classicStratHarvest1Addresses(chainId).some((address) => asHex(address) === asHex(strategyAddress));
