import type { Hex } from 'viem';
import type { ChainOracleWithBeefyPricing } from '../../config/oracle';
import { BEEFY_SWAPPER_VALUE_SCALER } from '../../lib/decimal';
import type { FetchToken } from '../../lib/schema';
import { beefySwapperAbi } from '../abis/beefy/common/BeefySwapper';
import { beefyOracleAbi } from '../abis/beefy/oracle/BeefyOracle';

export type OracleMulticallContract = {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
};

export type MulticallResult<TResult = unknown> =
    | { status: 'success'; result: TResult }
    | { status: 'failure'; error: unknown }
    | undefined;

export type FreshPriceResult = readonly [bigint, bigint];
export type SwapperAmountOutResult = bigint;

export type SwapperTokenParse = {
    decimals: number;
    freshPrice?: bigint | null;
    onFailure?: () => void;
};

const getBeefySwapperAmountIn = (tokenDecimals: number): bigint =>
    10n ** BigInt(tokenDecimals) / BEEFY_SWAPPER_VALUE_SCALER;

const scaleSwapperOutput = (amountOut: bigint): bigint => amountOut * BEEFY_SWAPPER_VALUE_SCALER;

const priceToNativeWithFallback = (
    amountOut: bigint,
    tokenDecimals: number,
    oracleFreshPrice: bigint | null
): bigint => {
    const obviouslyWrong = amountOut === BigInt('10000000000000000000000000000000');
    const veryLarge = amountOut > BigInt('1000000000000000000000000');
    if (obviouslyWrong) {
        return 0n;
    }
    if (veryLarge) {
        return 10n ** BigInt(tokenDecimals);
    }
    if (amountOut > 0n) {
        return amountOut;
    }
    return oracleFreshPrice ?? 0n;
};

const parseSwapperToNativePrice = (
    result: MulticallResult<SwapperAmountOutResult>,
    token: SwapperTokenParse
): bigint => {
    if (result?.status !== 'success') {
        token.onFailure?.();
    }
    const swapperOut = result?.status === 'success' ? scaleSwapperOutput(result.result) : 0n;
    if (token.freshPrice !== undefined) {
        return priceToNativeWithFallback(swapperOut, token.decimals, token.freshPrice);
    }
    return swapperOut;
};

export const buildBeefyOracleFreshPriceCalls = (
    oracleConfig: ChainOracleWithBeefyPricing,
    tokenAddresses: readonly Hex[]
): OracleMulticallContract[] =>
    tokenAddresses.map((tokenAddress) => ({
        address: oracleConfig.beefyOracleAddress,
        abi: beefyOracleAbi,
        functionName: 'getFreshPrice',
        args: [tokenAddress],
    }));

export const buildBeefySwapperToNativeCalls = (
    oracleConfig: ChainOracleWithBeefyPricing,
    tokens: readonly FetchToken[]
): OracleMulticallContract[] =>
    tokens.map((token) => {
        const amountIn = getBeefySwapperAmountIn(token.decimals);
        return {
            address: oracleConfig.beefySwapperAddress,
            abi: beefySwapperAbi,
            functionName: 'getAmountOut',
            args: [token.address, oracleConfig.wrappedNativeAddress, amountIn],
        };
    });

export const parseBeefyOracleFreshPriceResults = (
    results: readonly MulticallResult<FreshPriceResult>[]
): (bigint | null)[] => results.map((res) => (res?.status === 'success' ? res.result[0] : null));

export const parseBeefySwapperToNativePrices = (
    results: readonly MulticallResult<SwapperAmountOutResult>[],
    tokens: readonly SwapperTokenParse[]
): bigint[] => tokens.map((token, i) => parseSwapperToNativePrice(results[i], token));
