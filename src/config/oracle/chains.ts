import type { EvmChainId } from 'envio';
import { toBytes } from '../../lib/hex';
import {
    getBeefyOracleAddress,
    getBeefySwapperAddress,
    getWrappedNativeAddress,
    getWrappedNativeDecimals,
} from './addressbook';
import type { ChainOracleConfig, ChainOracleWithBeefyPricing } from './types';

const DEFAULT_CHAINLINK_FEED_DECIMALS = 8;
const DEFAULT_UMBRELLA_FEED_DECIMALS = 8;
const DEFAULT_UMBRELLA_REGISTRY = toBytes('0x4A28406ECe8FfD7A91789738A5AC15DAC44bfA1B');
const DEFAULT_UMBRELLA_FEED_NAME = toBytes('0xd2a0ad2667ba45a57ce6a98d6f51a4a4d256d704f578b3b90d7ee12e2f6af854');

function getBaseConfig(chainId: EvmChainId) {
    return {
        chainId,
        wrappedNativeAddress: getWrappedNativeAddress(chainId),
        wrappedNativeDecimals: getWrappedNativeDecimals(chainId),
    };
}

function getBeefyPricingConfig(chainId: EvmChainId): ChainOracleWithBeefyPricing {
    return {
        ...getBaseConfig(chainId),
        beefySwapperAddress: getBeefySwapperAddress(chainId),
        beefyOracleAddress: getBeefyOracleAddress(chainId),
    };
}

export const ORACLE_CONFIGS: Record<EvmChainId, ChainOracleConfig> = {
    1: {
        // ethereum
        ...getBeefyPricingConfig(1),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    10: {
        // optimism
        ...getBeefyPricingConfig(10),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x13e3Ee699D1909E989722E753853AE30b17e08c5'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    25: {
        // cronos
        ...getBaseConfig(25),
        priceOracleType: 'noop',
    },

    30: {
        // rootstock
        ...getBeefyPricingConfig(30),
        priceOracleType: 'umbrella',
        umbrellaRegistryAddress: DEFAULT_UMBRELLA_REGISTRY,
        umbrellaRegistryPriceFeedNameBytes32: DEFAULT_UMBRELLA_FEED_NAME,
        umbrellaRegistryPriceFeedDecimals: DEFAULT_UMBRELLA_FEED_DECIMALS,
    },

    56: {
        // bsc
        ...getBeefyPricingConfig(56),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    100: {
        // gnosis
        ...getBeefyPricingConfig(100),
        priceOracleType: 'beefy',
    },

    137: {
        // polygon
        ...getBeefyPricingConfig(137),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0xAB594600376Ec9fD91F8e885dADF0CE036862dE0'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    143: {
        // monad
        ...getBeefyPricingConfig(143),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0xBcD78f76005B7515837af6b50c7C52BCf73822fb'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    146: {
        // sonic
        ...getBeefyPricingConfig(146),
        priceOracleType: 'beefy',
    },

    250: {
        // fantom
        ...getBaseConfig(250),
        priceOracleType: 'noop',
    },

    252: {
        // fraxtal
        ...getBeefyPricingConfig(252),
        priceOracleType: 'beefy',
    },

    324: {
        // zksync
        ...getBeefyPricingConfig(324),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x6D41d1dc818112880b40e26BD6FD347E41008eDA'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    999: {
        // hyperevm
        ...getBeefyPricingConfig(999),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0xa8a94Da411425634e3Ed6C331a32ab4fd774aa43'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    1088: {
        // metis
        ...getBaseConfig(1088),
        priceOracleType: 'noop',
    },

    1101: {
        // zkevm (polygon)
        ...getBaseConfig(1101),
        priceOracleType: 'noop',
    },

    1135: {
        // lisk
        ...getBeefyPricingConfig(1135),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x6b7AB4213c77A671Fc7AEe8eB23C9961fDdaB3b2'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    1284: {
        // moonbeam
        ...getBeefyPricingConfig(1284),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x4497B606be93e773bbA5eaCFCb2ac5E2214220Eb'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    1285: {
        // moonriver
        ...getBaseConfig(1285),
        priceOracleType: 'noop',
    },

    1329: {
        // sei
        ...getBeefyPricingConfig(1329),
        priceOracleType: 'pyth',
        pythPriceFeedAddress: toBytes('0x2880aB155794e7179c9eE2e38200202908C17B43'),
        pythNativePriceId: toBytes('0x53614f1cb0c031d4af66c04cb9c756234adad0e1cee85303795091499a4084eb'),
    },

    2222: {
        // kava
        ...getBaseConfig(2222),
        priceOracleType: 'noop',
    },

    4326: {
        // megaeth
        ...getBeefyPricingConfig(4326),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0xcA4e254D95637DE95E2a2F79244b03380d697feD'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    5000: {
        // mantle
        ...getBeefyPricingConfig(5000),
        priceOracleType: 'pyth',
        pythPriceFeedAddress: toBytes('0xA2aa501b19aff244D90cc15a4Cf739D2725B5729'),
        pythNativePriceId: toBytes('0x4e3037c822d852d79af3ac80e35eb420ee3b870dca49f9344a38ef4773fb0585'),
    },

    8453: {
        // base
        ...getBeefyPricingConfig(8453),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    9745: {
        // plasma
        ...getBeefyPricingConfig(9745),
        priceOracleType: 'beefy',
    },

    80094: {
        // berachain
        ...getBeefyPricingConfig(80094),
        priceOracleType: 'beefy',
    },

    42161: {
        // arbitrum
        ...getBeefyPricingConfig(42161),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    43114: {
        // avax
        ...getBeefyPricingConfig(43114),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x0A77230d17318075983913bC2145DB16C7366156'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    59144: {
        // linea
        ...getBeefyPricingConfig(59144),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },

    534352: {
        // scroll
        ...getBeefyPricingConfig(534352),
        priceOracleType: 'chainlink',
        chainlinkNativePriceFeedAddress: toBytes('0x6bF14CB0A831078629D993FDeBcB182b21A8774C'),
        chainlinkNativePriceFeedDecimals: DEFAULT_CHAINLINK_FEED_DECIMALS,
    },
};
