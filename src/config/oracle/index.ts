import type { EvmChainId } from 'envio';
import { ORACLE_CONFIGS } from './chains';
import type {
    BeefyOracleConfig,
    ChainlinkOracleConfig,
    ChainOracleConfig,
    PriceOracleType,
    PythOracleConfig,
    UmbrellaOracleConfig,
} from './types';

export type {
    BeefyOracleConfig,
    ChainlinkOracleConfig,
    ChainOracleConfig,
    PriceOracleType,
    PythOracleConfig,
    UmbrellaOracleConfig,
};

export const getChainOracleConfig = (chainId: EvmChainId): ChainOracleConfig | undefined => {
    return ORACLE_CONFIGS[chainId];
};
