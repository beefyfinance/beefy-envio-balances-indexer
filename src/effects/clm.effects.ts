import { createEffect, type Logger, S } from 'envio';
import * as R from 'remeda';
import type { Hex } from 'viem';
import { getChainOracleConfig, hasBeefyTokenPricing } from '../config/oracle';
import { splitBatchResults, zipSameLength } from '../lib/array';
import { chainIdSchema } from '../lib/chain';
import type { ClmTokens } from '../lib/clm/tokens';
import { changeValueEncoding, interpretAsDecimal, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE } from '../lib/decimal';
import { hexSchema, normalizeHex } from '../lib/hex';
import { fetchTokenSchema, type ToBigDecimal } from '../lib/schema';
import { getViemClient } from '../lib/viem';
import { clmManagerAbi } from './abis/beefy/clm/ClmManager';
import { clmStrategyAbi } from './abis/beefy/clm/ClmStrategy';
import {
    buildBeefyOracleFreshPriceCalls,
    buildBeefySwapperToNativeCalls,
    type FreshPriceResult,
    fetchNativeToUSDPriceRaw,
    type MulticallResult,
    parseBeefySwapperToNativePrices,
    type SwapperAmountOutResult,
} from './oracle/index';

const clmStateSchema = S.schema({
    managerTotalSupply: S.bigint,
    rewardPoolsTotalSupply: S.array(S.bigint),
    totalUnderlyingAmount0: S.bigint,
    totalUnderlyingAmount1: S.bigint,
    underlyingMainAmount0: S.bigint,
    underlyingMainAmount1: S.bigint,
    underlyingAltAmount0: S.bigint,
    underlyingAltAmount1: S.bigint,
    priceOfToken0InToken1: S.bigint,
    priceRangeMin1: S.bigint,
    priceRangeMax1: S.bigint,
    token0ToNativePrice: S.bigint,
    token1ToNativePrice: S.bigint,
    outputToNativePrices: S.array(S.bigint),
    rewardToNativePrices: S.array(S.bigint),
    nativeToUSDPrice: S.bigint,
});

type ClmRawState = S.Infer<typeof clmStateSchema>;
export type ClmState = ToBigDecimal<ClmRawState>;

type TotalSupplyResult = bigint;
type ClmBalancesResult = readonly [bigint, bigint];
type ClmBalancesOfPoolResult = readonly [bigint, bigint, bigint, bigint, bigint, bigint];
type ClmPriceResult = bigint;
type ClmRangeResult = readonly [bigint, bigint];

const fetchClmStateInputSchema = S.schema({
    chainId: chainIdSchema,
    blockNumber: S.number,
    managerAddress: hexSchema,
    strategyAddress: hexSchema,
    underlyingToken0Address: hexSchema,
    underlyingToken1Address: hexSchema,
    underlyingToken0Decimals: S.number,
    underlyingToken1Decimals: S.number,
    rewardPoolTokenAddresses: S.array(hexSchema),
    outputTokenAddresses: S.array(hexSchema),
    rewardTokens: S.array(fetchTokenSchema),
});

export const parseFetchedClmState = (raw: ClmRawState, tokens: ClmTokens): ClmState => ({
    managerTotalSupply: interpretAsDecimal(raw.managerTotalSupply, tokens.managerToken.decimals),
    rewardPoolsTotalSupply: zipSameLength(raw.rewardPoolsTotalSupply, tokens.rewardPoolTokens).map(([supply, token]) =>
        interpretAsDecimal(supply, token.decimals)
    ),
    totalUnderlyingAmount0: interpretAsDecimal(raw.totalUnderlyingAmount0, tokens.underlyingToken0.decimals),
    totalUnderlyingAmount1: interpretAsDecimal(raw.totalUnderlyingAmount1, tokens.underlyingToken1.decimals),
    underlyingMainAmount0: interpretAsDecimal(raw.underlyingMainAmount0, tokens.underlyingToken0.decimals),
    underlyingMainAmount1: interpretAsDecimal(raw.underlyingMainAmount1, tokens.underlyingToken1.decimals),
    underlyingAltAmount0: interpretAsDecimal(raw.underlyingAltAmount0, tokens.underlyingToken0.decimals),
    underlyingAltAmount1: interpretAsDecimal(raw.underlyingAltAmount1, tokens.underlyingToken1.decimals),
    priceOfToken0InToken1: interpretAsDecimal(raw.priceOfToken0InToken1, tokens.underlyingToken1.decimals),
    priceRangeMin1: interpretAsDecimal(raw.priceRangeMin1, tokens.underlyingToken1.decimals),
    priceRangeMax1: interpretAsDecimal(raw.priceRangeMax1, tokens.underlyingToken1.decimals),
    token0ToNativePrice: interpretAsDecimal(raw.token0ToNativePrice, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE),
    token1ToNativePrice: interpretAsDecimal(raw.token1ToNativePrice, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE),
    outputToNativePrices: raw.outputToNativePrices.map((price) =>
        interpretAsDecimal(price, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE)
    ),
    rewardToNativePrices: raw.rewardToNativePrices.map((price) =>
        interpretAsDecimal(price, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE)
    ),
    nativeToUSDPrice: interpretAsDecimal(raw.nativeToUSDPrice, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE),
});

export const fetchClmState = createEffect(
    {
        name: 'fetchClmState',
        input: fetchClmStateInputSchema,
        output: clmStateSchema,
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => fetchClmStateRaw({ input, context })
);

export const fetchClmStates = createEffect(
    {
        name: 'fetchClmStates',
        input: S.schema({
            requests: S.array(fetchClmStateInputSchema),
        }),
        output: S.schema({
            states: S.array(clmStateSchema),
        }),
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const states = await Promise.all(
            input.requests.map((request) => fetchClmStateRaw({ input: request, context }))
        );
        return { states };
    }
);

const fetchClmStateRaw = async ({
    input,
    context,
}: {
    input: S.Infer<typeof fetchClmStateInputSchema>;
    context: { log: Logger };
}): Promise<ClmRawState> => {
    const {
        chainId,
        blockNumber,
        managerAddress,
        strategyAddress,
        underlyingToken0Address,
        underlyingToken1Address,
        underlyingToken0Decimals,
        underlyingToken1Decimals,
        rewardPoolTokenAddresses,
        outputTokenAddresses,
        rewardTokens,
    } = input;

    const oracleConfig = getChainOracleConfig(chainId);
    const client = getViemClient(chainId, context.log);

    const coreCalls = [
        {
            address: managerAddress as `0x${string}`,
            abi: clmManagerAbi,
            functionName: 'totalSupply' as const,
        },
        {
            address: managerAddress as `0x${string}`,
            abi: clmManagerAbi,
            functionName: 'balances' as const,
        },
        {
            address: strategyAddress as `0x${string}`,
            abi: clmStrategyAbi,
            functionName: 'balancesOfPool' as const,
        },
        {
            address: strategyAddress as `0x${string}`,
            abi: clmStrategyAbi,
            functionName: 'price' as const,
        },
        {
            address: strategyAddress as `0x${string}`,
            abi: clmStrategyAbi,
            functionName: 'range' as const,
        },
    ];

    const rewardPoolCalls = R.map(rewardPoolTokenAddresses, (address) => ({
        address: address as `0x${string}`,
        abi: clmManagerAbi,
        functionName: 'totalSupply' as const,
    }));

    const tokensToRefresh: Hex[] = [];
    if (hasBeefyTokenPricing(oracleConfig)) {
        tokensToRefresh.push(normalizeHex(oracleConfig.wrappedNativeAddress));
        tokensToRefresh.push(normalizeHex(underlyingToken0Address));
        tokensToRefresh.push(normalizeHex(underlyingToken1Address));
        for (const outputTokenAddress of outputTokenAddresses) {
            tokensToRefresh.push(normalizeHex(outputTokenAddress));
        }
        for (const rewardToken of rewardTokens) {
            tokensToRefresh.push(normalizeHex(rewardToken.address));
        }
    }

    const swapperUnderlyingTokens = [
        { address: underlyingToken0Address, decimals: underlyingToken0Decimals },
        { address: underlyingToken1Address, decimals: underlyingToken1Decimals },
    ];
    const swapperOutputTokens = hasBeefyTokenPricing(oracleConfig)
        ? outputTokenAddresses.map((address) => ({
              address,
              decimals: oracleConfig.wrappedNativeDecimals,
          }))
        : [];

    const oracleFreshCalls = hasBeefyTokenPricing(oracleConfig)
        ? buildBeefyOracleFreshPriceCalls(oracleConfig, tokensToRefresh)
        : [];
    const swapperUnderlyingCalls = hasBeefyTokenPricing(oracleConfig)
        ? buildBeefySwapperToNativeCalls(oracleConfig, swapperUnderlyingTokens)
        : [];
    const swapperRewardCalls = hasBeefyTokenPricing(oracleConfig)
        ? buildBeefySwapperToNativeCalls(oracleConfig, rewardTokens)
        : [];
    const swapperOutputCalls = hasBeefyTokenPricing(oracleConfig)
        ? buildBeefySwapperToNativeCalls(oracleConfig, swapperOutputTokens)
        : [];

    const rawResults = await client.multicall({
        allowFailure: true,
        blockNumber: BigInt(blockNumber),
        contracts: [
            ...coreCalls,
            ...rewardPoolCalls,
            ...oracleFreshCalls,
            ...swapperUnderlyingCalls,
            ...swapperRewardCalls,
            ...swapperOutputCalls,
        ] as Parameters<typeof client.multicall>[0]['contracts'],
    });

    const priceDecimals = 36 + underlyingToken1Decimals - underlyingToken0Decimals;

    const [
        coreResults,
        rewardPoolResults,
        _oracleFreshResults,
        swapperUnderlyingResults,
        swapperRewardResults,
        swapperOutputResults,
    ] = splitBatchResults(rawResults, [
        coreCalls.length,
        rewardPoolCalls.length,
        oracleFreshCalls.length,
        swapperUnderlyingCalls.length,
        swapperRewardCalls.length,
        swapperOutputCalls.length,
    ]) as [
        [
            MulticallResult<TotalSupplyResult>,
            MulticallResult<ClmBalancesResult>,
            MulticallResult<ClmBalancesOfPoolResult>,
            MulticallResult<ClmPriceResult>,
            MulticallResult<ClmRangeResult>,
        ],
        MulticallResult<TotalSupplyResult>[],
        MulticallResult<FreshPriceResult>[],
        MulticallResult<SwapperAmountOutResult>[],
        MulticallResult<SwapperAmountOutResult>[],
        MulticallResult<SwapperAmountOutResult>[],
    ];

    const [totalSupplyRes, balanceRes, balanceOfPoolRes, priceRes, rangeRes] = coreResults;

    let managerTotalSupply = 0n;
    if (totalSupplyRes?.status === 'success') {
        managerTotalSupply = totalSupplyRes.result as bigint;
    } else {
        context.log.error('Failed to fetch totalSupply for CLM', { managerAddress, chainId });
    }

    let totalUnderlyingAmount0 = 0n;
    let totalUnderlyingAmount1 = 0n;
    if (balanceRes?.status === 'success') {
        [totalUnderlyingAmount0, totalUnderlyingAmount1] = balanceRes.result as [bigint, bigint];
    } else {
        context.log.error('Failed to fetch balances for CLM', { managerAddress, chainId });
    }

    let underlyingMainAmount0 = 0n;
    let underlyingMainAmount1 = 0n;
    let underlyingAltAmount0 = 0n;
    let underlyingAltAmount1 = 0n;
    if (balanceOfPoolRes?.status === 'success') {
        [, , underlyingMainAmount0, underlyingMainAmount1, underlyingAltAmount0, underlyingAltAmount1] =
            balanceOfPoolRes.result as [bigint, bigint, bigint, bigint, bigint, bigint];
    } else {
        context.log.error('Failed to fetch balancesOfPool for CLM', { managerAddress, chainId });
    }

    let priceOfToken0InToken1 = 0n;
    if (priceRes?.status === 'success') {
        priceOfToken0InToken1 = changeValueEncoding(priceRes.result as bigint, priceDecimals, underlyingToken1Decimals);
    } else {
        context.log.warn('Failed to fetch price for CLM', { managerAddress, chainId });
    }

    let priceRangeMin1 = 0n;
    let priceRangeMax1 = 0n;
    if (rangeRes?.status === 'success') {
        const range = rangeRes.result as [bigint, bigint];
        priceRangeMin1 = changeValueEncoding(range[0], priceDecimals, underlyingToken1Decimals);
        priceRangeMax1 = changeValueEncoding(range[1], priceDecimals, underlyingToken1Decimals);
    } else {
        context.log.warn('Failed to fetch price range for CLM', { managerAddress, chainId });
    }

    const nativeToUSDPriceBigInt = await fetchNativeToUSDPriceRaw(chainId, context.log, blockNumber);

    let token0ToNativePrice = 0n;
    let token1ToNativePrice = 0n;
    let rewardToNativePrices: bigint[] = [];
    let outputToNativePrices: bigint[] = [];

    if (hasBeefyTokenPricing(oracleConfig)) {
        const clmLogContext = { managerAddress, chainId };
        const underlyingToNativePrices = parseBeefySwapperToNativePrices(swapperUnderlyingResults, [
            {
                decimals: underlyingToken0Decimals,
                onFailure: () => context.log.error('Failed to fetch token0ToNativePrice for CLM', clmLogContext),
            },
            {
                decimals: underlyingToken1Decimals,
                onFailure: () => context.log.error('Failed to fetch token1ToNativePrice for CLM', clmLogContext),
            },
        ]);
        token0ToNativePrice = underlyingToNativePrices[0] ?? 0n;
        token1ToNativePrice = underlyingToNativePrices[1] ?? 0n;

        rewardToNativePrices = parseBeefySwapperToNativePrices(
            swapperRewardResults,
            rewardTokens.map((token) => ({
                decimals: token.decimals,
                onFailure: () => context.log.error('Failed to fetch rewardToNativePrices for CLM', clmLogContext),
            }))
        );

        outputToNativePrices = parseBeefySwapperToNativePrices(
            swapperOutputResults,
            outputTokenAddresses.map(() => ({
                decimals: oracleConfig.wrappedNativeDecimals,
                onFailure: () => context.log.error('Failed to fetch outputToNativePrices for CLM', clmLogContext),
            }))
        );
    }

    const rewardPoolsTotalSupply = rewardPoolResults.map((totalSupplyResult) => {
        if (totalSupplyResult?.status === 'success') {
            return totalSupplyResult.result as bigint;
        }
        context.log.error('Failed to fetch rewardPoolsTotalSupply for CLM', { managerAddress, chainId });
        return 0n;
    });

    return {
        managerTotalSupply,
        rewardPoolsTotalSupply,
        totalUnderlyingAmount0,
        totalUnderlyingAmount1,
        underlyingMainAmount0,
        underlyingMainAmount1,
        underlyingAltAmount0,
        underlyingAltAmount1,
        priceOfToken0InToken1,
        priceRangeMin1,
        priceRangeMax1,
        token0ToNativePrice,
        token1ToNativePrice,
        outputToNativePrices,
        rewardToNativePrices,
        nativeToUSDPrice: nativeToUSDPriceBigInt,
    };
};

export const getClmManagerStrategy = createEffect(
    {
        name: 'getClmManagerStrategy',
        input: {
            managerAddress: hexSchema,
            chainId: chainIdSchema,
            blockNumber: S.number,
        },
        output: {
            strategyAddress: hexSchema,
        },
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const client = getViemClient(input.chainId, context.log);
        const [result] = await client.multicall({
            allowFailure: true,
            blockNumber: BigInt(input.blockNumber),
            contracts: [
                {
                    address: input.managerAddress as `0x${string}`,
                    abi: clmManagerAbi,
                    functionName: 'strategy',
                },
            ],
        });

        if (result.status === 'failure') {
            context.log.error('ClmManager strategy call failed', input);
            return { strategyAddress: normalizeHex('0x0000000000000000000000000000000000000000') };
        }

        return { strategyAddress: normalizeHex(result.result) };
    }
);

export const getClmStrategyInitData = createEffect(
    {
        name: 'getClmStrategyInitData',
        input: {
            strategyAddress: hexSchema,
            chainId: chainIdSchema,
            blockNumber: S.number,
        },
        output: {
            underlyingProtocolPool: hexSchema,
            outputTokenAddress: hexSchema,
        },
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const client = getViemClient(input.chainId, context.log);
        const [poolResult, outputResult] = await client.multicall({
            allowFailure: true,
            blockNumber: BigInt(input.blockNumber),
            contracts: [
                {
                    address: input.strategyAddress as `0x${string}`,
                    abi: clmStrategyAbi,
                    functionName: 'pool',
                },
                {
                    address: input.strategyAddress as `0x${string}`,
                    abi: clmStrategyAbi,
                    functionName: 'output',
                },
            ],
        });

        const underlyingProtocolPool =
            poolResult.status === 'success'
                ? normalizeHex(poolResult.result)
                : normalizeHex('0x0000000000000000000000000000000000000000');
        const outputTokenAddress =
            outputResult.status === 'success'
                ? normalizeHex(outputResult.result)
                : normalizeHex('0x0000000000000000000000000000000000000000');

        return { underlyingProtocolPool, outputTokenAddress };
    }
);
