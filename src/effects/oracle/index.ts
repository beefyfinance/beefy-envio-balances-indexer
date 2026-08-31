import { createEffect, type Logger, S } from 'envio';
import type { Hex } from 'viem';
import { type ChainOracleConfig, getChainOracleConfig } from '../../config/oracle';
import { chainIdSchema } from '../../lib/chain';
import { changeValueEncoding, PRICE_STORE_DECIMALS_USD } from '../../lib/decimal';
import { getViemClient } from '../../lib/viem';
import { beefyOracleAbi } from '../abis/beefy/oracle/BeefyOracle';
import { chainlinkPriceFeedAbi } from '../abis/chainlink/ChainlinkPriceFeed';
import { pythAbi } from '../abis/pyth/Pyth';
import { umbrellaPriceFeedAbi } from '../abis/umbrella/UmbrellaPriceFeed';
import { umbrellaRegistryAbi } from '../abis/umbrella/UmbrellaRegistry';

export type { FetchToken } from '../../lib/schema';
export {
    buildBeefyOracleFreshPriceCalls,
    buildBeefySwapperToNativeCalls,
    type FreshPriceResult,
    type MulticallResult,
    type OracleMulticallContract,
    parseBeefyOracleFreshPriceResults,
    parseBeefySwapperToNativePrices,
    type SwapperAmountOutResult,
    type SwapperTokenParse,
} from './beefyPricing';
export type { ChainOracleConfig };
export { getChainOracleConfig };

const UMBRELLA_REGISTRY_FEED_KEY_BYTES_32 = '0x556d6272656c6c61466565647300000000000000000000000000000000000000' as Hex;

const fetchNativeToUSDPriceFromConfig = async (
    client: ReturnType<typeof getViemClient>,
    oracleConfig: ChainOracleConfig,
    log: Logger,
    blockNumber: number
): Promise<bigint> => {
    const { priceOracleType } = oracleConfig;
    const blockTag = { blockNumber: BigInt(blockNumber) };

    if (priceOracleType === 'noop') {
        return 0n;
    }

    if (priceOracleType === 'chainlink') {
        const [result] = await client.multicall({
            allowFailure: true,
            ...blockTag,
            contracts: [
                {
                    address: oracleConfig.chainlinkNativePriceFeedAddress,
                    abi: chainlinkPriceFeedAbi,
                    functionName: 'latestRoundData',
                },
            ],
        });
        if (result.status === 'failure') {
            log.error('Failed to fetch chainlink native price');
            return 0n;
        }
        const answer = result.result[1];
        return changeValueEncoding(
            answer < 0n ? 0n : answer,
            oracleConfig.chainlinkNativePriceFeedDecimals,
            PRICE_STORE_DECIMALS_USD
        );
    }

    if (priceOracleType === 'pyth') {
        const [result] = await client.multicall({
            allowFailure: true,
            ...blockTag,
            contracts: [
                {
                    address: oracleConfig.pythPriceFeedAddress,
                    abi: pythAbi,
                    functionName: 'getPriceUnsafe',
                    args: [oracleConfig.pythNativePriceId],
                },
            ],
        });
        if (result.status === 'failure') {
            log.error('Failed to fetch pyth native price');
            return 0n;
        }
        const value = result.result[0];
        const exponent = result.result[2];
        const decimals = exponent < 0 ? -Number(exponent) : 0;
        return changeValueEncoding(value < 0n ? 0n : value, decimals, PRICE_STORE_DECIMALS_USD);
    }

    if (priceOracleType === 'umbrella') {
        const [registryResult] = await client.multicall({
            allowFailure: true,
            ...blockTag,
            contracts: [
                {
                    address: oracleConfig.umbrellaRegistryAddress,
                    abi: umbrellaRegistryAbi,
                    functionName: 'getAddress',
                    args: [UMBRELLA_REGISTRY_FEED_KEY_BYTES_32],
                },
            ],
        });
        if (registryResult.status === 'failure') {
            log.error('Failed to fetch umbrella feeds contract address');
            return 0n;
        }
        const [priceResult] = await client.multicall({
            allowFailure: true,
            ...blockTag,
            contracts: [
                {
                    address: registryResult.result,
                    abi: umbrellaPriceFeedAbi,
                    functionName: 'getPriceData',
                    args: [oracleConfig.umbrellaRegistryPriceFeedNameBytes32],
                },
            ],
        });
        if (priceResult.status === 'failure') {
            log.error('Failed to fetch umbrella native price');
            return 0n;
        }
        return changeValueEncoding(
            priceResult.result[3],
            oracleConfig.umbrellaRegistryPriceFeedDecimals,
            PRICE_STORE_DECIMALS_USD
        );
    }

    if (priceOracleType === 'beefy') {
        const [result] = await client.multicall({
            allowFailure: true,
            ...blockTag,
            contracts: [
                {
                    address: oracleConfig.beefyOracleAddress,
                    abi: beefyOracleAbi,
                    functionName: 'getPrice',
                    args: [oracleConfig.wrappedNativeAddress],
                },
            ],
        });
        if (result.status === 'failure') {
            log.error('Failed to fetch beefy oracle native price');
            return 0n;
        }
        return changeValueEncoding(result.result, oracleConfig.wrappedNativeDecimals, PRICE_STORE_DECIMALS_USD);
    }

    log.error('Unsupported price oracle type', { priceOracleType });
    return 0n;
};

export const fetchNativeToUSDPriceRaw = async (
    chainId: Parameters<typeof getViemClient>[0],
    log: Logger,
    blockNumber: number
): Promise<bigint> => {
    const oracleConfig = getChainOracleConfig(chainId);
    if (!oracleConfig) {
        log.warn('No oracle config for chain', { chainId });
        return 0n;
    }
    const client = getViemClient(chainId, log);
    return fetchNativeToUSDPriceFromConfig(client, oracleConfig, log, blockNumber);
};

const fetchNativeToUSDPriceOutputSchema = S.schema({
    nativeToUSDPrice: S.bigint,
});

export const fetchNativeToUSDPrice = createEffect(
    {
        name: 'fetchNativeToUSDPrice',
        input: {
            chainId: chainIdSchema,
            blockNumber: S.number,
        },
        output: fetchNativeToUSDPriceOutputSchema,
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => ({
        nativeToUSDPrice: await fetchNativeToUSDPriceRaw(input.chainId, context.log, input.blockNumber),
    })
);
