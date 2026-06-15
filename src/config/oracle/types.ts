import type { EvmChainId } from 'envio';
import type { Hex } from 'viem';

export type PriceOracleType = 'chainlink' | 'pyth' | 'umbrella' | 'beefy' | 'noop';

type ChainOracleBase = {
    chainId: EvmChainId;
    wrappedNativeAddress: Hex;
    wrappedNativeDecimals: number;
};

export type ChainOracleWithBeefyPricing = ChainOracleBase & {
    beefySwapperAddress: Hex;
    beefyOracleAddress: Hex;
};

export type NoopOracleConfig = ChainOracleBase & {
    priceOracleType: 'noop';
};

export type ChainlinkOracleConfig = ChainOracleWithBeefyPricing & {
    priceOracleType: 'chainlink';
    chainlinkNativePriceFeedAddress: Hex;
    chainlinkNativePriceFeedDecimals: number;
};

export type PythOracleConfig = ChainOracleWithBeefyPricing & {
    priceOracleType: 'pyth';
    pythPriceFeedAddress: Hex;
    pythNativePriceId: Hex;
};

export type UmbrellaOracleConfig = ChainOracleWithBeefyPricing & {
    priceOracleType: 'umbrella';
    umbrellaRegistryAddress: Hex;
    umbrellaRegistryPriceFeedNameBytes32: Hex;
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
