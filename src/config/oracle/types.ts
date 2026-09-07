import type { EvmChainId } from 'envio';
import type { Bytes } from '../../lib/hex';

export type PriceOracleType = 'chainlink' | 'pyth' | 'umbrella' | 'beefy' | 'noop';

type ChainOracleBase = {
    chainId: EvmChainId;
    wrappedNativeAddress: Bytes;
    wrappedNativeDecimals: number;
};

export type ChainOracleWithBeefyPricing = ChainOracleBase & {
    beefySwapperAddress: Bytes;
    beefyOracleAddress: Bytes;
};

export type NoopOracleConfig = ChainOracleBase & {
    priceOracleType: 'noop';
};

export type ChainlinkOracleConfig = ChainOracleWithBeefyPricing & {
    priceOracleType: 'chainlink';
    chainlinkNativePriceFeedAddress: Bytes;
    chainlinkNativePriceFeedDecimals: number;
};

export type PythOracleConfig = ChainOracleWithBeefyPricing & {
    priceOracleType: 'pyth';
    pythPriceFeedAddress: Bytes;
    pythNativePriceId: Bytes;
};

export type UmbrellaOracleConfig = ChainOracleWithBeefyPricing & {
    priceOracleType: 'umbrella';
    umbrellaRegistryAddress: Bytes;
    umbrellaRegistryPriceFeedNameBytes32: Bytes;
    umbrellaRegistryPriceFeedDecimals: number;
};

export type BeefyOracleConfig = ChainOracleWithBeefyPricing & {
    priceOracleType: 'beefy';
};

export type ChainOracleConfig =
    | ChainlinkOracleConfig
    | PythOracleConfig
    | UmbrellaOracleConfig
    | BeefyOracleConfig
    | NoopOracleConfig;
