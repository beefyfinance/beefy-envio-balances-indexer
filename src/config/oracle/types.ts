import type { EvmChainId } from 'envio';
import type { Hex } from 'viem';

export type PriceOracleType = 'chainlink' | 'pyth' | 'umbrella' | 'beefy';

type ChainOracleBase = {
    chainId: EvmChainId;
    wrappedNativeAddress: Hex;
    wrappedNativeDecimals: number;
    beefySwapperAddress: Hex;
    beefyOracleAddress: Hex;
};

export type ChainlinkOracleConfig = ChainOracleBase & {
    priceOracleType: 'chainlink';
    chainlinkNativePriceFeedAddress: Hex;
    chainlinkNativePriceFeedDecimals: number;
};

export type PythOracleConfig = ChainOracleBase & {
    priceOracleType: 'pyth';
    pythPriceFeedAddress: Hex;
    pythNativePriceId: Hex;
};

export type UmbrellaOracleConfig = ChainOracleBase & {
    priceOracleType: 'umbrella';
    umbrellaRegistryAddress: Hex;
    umbrellaRegistryPriceFeedNameBytes32: Hex;
    umbrellaRegistryPriceFeedDecimals: number;
};

export type BeefyOracleConfig = ChainOracleBase & {
    priceOracleType: 'beefy';
};

export type ChainOracleConfig = ChainlinkOracleConfig | PythOracleConfig | UmbrellaOracleConfig | BeefyOracleConfig;
