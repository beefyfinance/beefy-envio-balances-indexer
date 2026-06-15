import type { EvmChainId } from 'envio';
import { ORACLE_CONFIGS } from './chains';
import type {
    BeefyOracleConfig,
    ChainlinkOracleConfig,
    ChainOracleConfig,
    ChainOracleWithBeefyPricing,
    NoopOracleConfig,
    PriceOracleType,
    PythOracleConfig,
    UmbrellaOracleConfig,
} from './types';

export type {
    BeefyOracleConfig,
    ChainlinkOracleConfig,
    ChainOracleConfig,
    ChainOracleWithBeefyPricing,
    NoopOracleConfig,
    PriceOracleType,
    PythOracleConfig,
    UmbrellaOracleConfig,
};

export const hasBeefyTokenPricing = (
    config: ChainOracleConfig | undefined
): config is Exclude<ChainOracleConfig, NoopOracleConfig> => config !== undefined && config.priceOracleType !== 'noop';

export const getChainOracleConfig = (chainId: EvmChainId): ChainOracleConfig | undefined => {
    return ORACLE_CONFIGS[chainId];
};
