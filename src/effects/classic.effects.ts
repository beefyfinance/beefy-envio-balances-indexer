import { createEffect, type Logger, S } from 'envio';
import * as R from 'remeda';
import type { Hex } from 'viem';
import { getChainOracleConfig } from '../config/oracle';
import { splitBatchResults, zipSameLength } from '../lib/array';
import { chainIdSchema } from '../lib/chain';
import {
    detectClassicVaultUnderlyingPlatform,
    getVaultTokenBreakdown,
    PLATFORM_BEEFY_LST_VAULT,
} from '../lib/classic/platform';
import type { ClassicTokens } from '../lib/classic/tokens';
import {
    ADDRESS_ZERO,
    changeValueEncoding,
    interpretAsDecimal,
    PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE,
} from '../lib/decimal';
import { hexSchema, normalizeHex } from '../lib/hex';
import { fetchTokenSchema, type ToBigDecimal } from '../lib/schema';
import { getViemClient } from '../lib/viem';
import { classicVaultAbi } from './abis/beefy/classic/ClassicVault';
import { clmManagerAbi } from './abis/beefy/clm/ClmManager';
import { ierc20Abi } from './abis/IERC20/IERC20';
import {
    buildBeefyOracleFreshPriceCalls,
    buildBeefySwapperToNativeCalls,
    type FreshPriceResult,
    fetchNativeToUSDPriceRaw,
    type MulticallResult,
    parseBeefyOracleFreshPriceResults,
    parseBeefySwapperToNativePrices,
    type SwapperAmountOutResult,
} from './oracle/index';

const classicStateSchema = S.schema({
    vaultTokenTotalSupply: S.bigint,
    vaultUnderlyingTotalSupply: S.bigint,
    vaultUnderlyingBreakdownBalances: S.array(S.bigint),
    rewardPoolsTotalSupply: S.array(S.bigint),
    erc4626AdaptersTotalSupply: S.array(S.bigint),
    erc4626AdapterVaultSharesBalances: S.array(S.bigint),
    underlyingAmount: S.bigint,
    underlyingToNativePrice: S.bigint,
    underlyingBreakdownToNativePrices: S.array(S.bigint),
    boostRewardToNativePrices: S.array(S.bigint),
    rewardToNativePrices: S.array(S.bigint),
    nativeToUSDPrice: S.bigint,
});

type ClassicRawState = S.Infer<typeof classicStateSchema>;
export type ClassicState = ToBigDecimal<ClassicRawState>;

type TotalSupplyResult = bigint;
type VaultUnderlyingBalanceResult = bigint;
type ClmBalancesResult = readonly [bigint, bigint];

const fetchClassicStateInputSchema = S.schema({
    chainId: chainIdSchema,
    blockNumber: S.number,
    vaultAddress: hexSchema,
    strategyAddress: hexSchema,
    underlyingTokenAddress: hexSchema,
    underlyingPlatform: S.string,
    underlyingTokenDecimals: S.number,
    underlyingBreakdownTokens: S.array(fetchTokenSchema),
    rewardPoolTokenAddresses: S.array(hexSchema),
    erc4626AdapterTokenAddresses: S.array(hexSchema),
    boostRewardTokens: S.array(fetchTokenSchema),
    rewardTokens: S.array(fetchTokenSchema),
    clmManagerAddress: hexSchema,
    clmUnderlyingToken0Address: hexSchema,
    clmUnderlyingToken1Address: hexSchema,
    clmUnderlyingToken0Decimals: S.number,
    clmUnderlyingToken1Decimals: S.number,
});

export const parseFetchedClassicState = (raw: ClassicRawState, tokens: ClassicTokens): ClassicState => ({
    vaultTokenTotalSupply: interpretAsDecimal(raw.vaultTokenTotalSupply, tokens.vaultToken.decimals),
    vaultUnderlyingTotalSupply: interpretAsDecimal(raw.vaultUnderlyingTotalSupply, tokens.underlyingToken.decimals),
    vaultUnderlyingBreakdownBalances: zipSameLength(
        raw.vaultUnderlyingBreakdownBalances,
        tokens.underlyingBreakdownTokens
    ).map(([balance, token]) => interpretAsDecimal(balance, token.decimals)),
    rewardPoolsTotalSupply: zipSameLength(raw.rewardPoolsTotalSupply, tokens.rewardPoolTokens).map(([supply, token]) =>
        interpretAsDecimal(supply, token.decimals)
    ),
    erc4626AdaptersTotalSupply: zipSameLength(raw.erc4626AdaptersTotalSupply, tokens.erc4626AdapterTokens).map(
        ([supply, token]) => interpretAsDecimal(supply, token.decimals)
    ),
    erc4626AdapterVaultSharesBalances: raw.erc4626AdapterVaultSharesBalances.map((balance) =>
        interpretAsDecimal(balance, tokens.vaultToken.decimals)
    ),
    underlyingAmount: interpretAsDecimal(raw.underlyingAmount, tokens.underlyingToken.decimals),
    underlyingToNativePrice: interpretAsDecimal(raw.underlyingToNativePrice, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE),
    underlyingBreakdownToNativePrices: raw.underlyingBreakdownToNativePrices.map((price) =>
        interpretAsDecimal(price, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE)
    ),
    boostRewardToNativePrices: raw.boostRewardToNativePrices.map((price) =>
        interpretAsDecimal(price, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE)
    ),
    rewardToNativePrices: raw.rewardToNativePrices.map((price) =>
        interpretAsDecimal(price, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE)
    ),
    nativeToUSDPrice: interpretAsDecimal(raw.nativeToUSDPrice, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE),
});

const fetchClassicStateRaw = async ({
    input,
    context,
}: {
    input: S.Infer<typeof fetchClassicStateInputSchema>;
    context: { log: Logger };
}): Promise<ClassicRawState> => {
    const {
        chainId,
        blockNumber,
        vaultAddress,
        strategyAddress,
        underlyingTokenAddress,
        underlyingPlatform,
        underlyingTokenDecimals,
        underlyingBreakdownTokens,
        rewardPoolTokenAddresses,
        erc4626AdapterTokenAddresses,
        boostRewardTokens,
        rewardTokens,
        clmManagerAddress,
        clmUnderlyingToken0Address,
        clmUnderlyingToken1Address,
        clmUnderlyingToken0Decimals,
        clmUnderlyingToken1Decimals,
    } = input;

    const oracleConfig = getChainOracleConfig(chainId);
    const client = getViemClient(chainId, context.log);

    const hasClmUnderlying = clmManagerAddress !== ADDRESS_ZERO;

    const coreCalls = [
        { address: vaultAddress, abi: ierc20Abi, functionName: 'totalSupply' as const },
        underlyingPlatform === PLATFORM_BEEFY_LST_VAULT
            ? { address: vaultAddress, abi: classicVaultAbi, functionName: 'totalAssets' as const }
            : { address: vaultAddress, abi: classicVaultAbi, functionName: 'balance' as const },
        { address: underlyingTokenAddress, abi: ierc20Abi, functionName: 'totalSupply' as const },
    ];

    const clmCalls =
        hasClmUnderlying && clmManagerAddress
            ? [
                  { address: clmManagerAddress, abi: clmManagerAbi, functionName: 'totalSupply' as const },
                  { address: clmManagerAddress, abi: clmManagerAbi, functionName: 'balances' as const },
              ]
            : [];

    const rewardPoolCalls = R.map(rewardPoolTokenAddresses, (address) => ({
        address,
        abi: ierc20Abi,
        functionName: 'totalSupply' as const,
    }));

    const erc4626Calls = R.flatMap(erc4626AdapterTokenAddresses, (address) => [
        { address, abi: ierc20Abi, functionName: 'totalSupply' as const },
        { address: vaultAddress, abi: ierc20Abi, functionName: 'balanceOf' as const, args: [address] as const },
    ]);

    const tokensToRefresh: Hex[] = [];
    if (oracleConfig) {
        tokensToRefresh.push(normalizeHex(oracleConfig.wrappedNativeAddress));
        for (const token of boostRewardTokens) {
            tokensToRefresh.push(normalizeHex(token.address));
        }
        for (const token of rewardTokens) {
            tokensToRefresh.push(normalizeHex(token.address));
        }
        for (const token of underlyingBreakdownTokens) {
            tokensToRefresh.push(normalizeHex(token.address));
        }
        if (hasClmUnderlying && clmUnderlyingToken0Address && clmUnderlyingToken1Address) {
            tokensToRefresh.push(normalizeHex(clmUnderlyingToken0Address));
            tokensToRefresh.push(normalizeHex(clmUnderlyingToken1Address));
        }
    }

    const swapperBoostCalls = oracleConfig ? buildBeefySwapperToNativeCalls(oracleConfig, boostRewardTokens) : [];
    const swapperRewardCalls = oracleConfig ? buildBeefySwapperToNativeCalls(oracleConfig, rewardTokens) : [];
    const swapperUnderlyingCalls = oracleConfig
        ? buildBeefySwapperToNativeCalls(oracleConfig, underlyingBreakdownTokens)
        : [];

    const oracleFreshCalls = oracleConfig ? buildBeefyOracleFreshPriceCalls(oracleConfig, tokensToRefresh) : [];

    const rawResults = await client.multicall({
        allowFailure: true,
        blockNumber: BigInt(blockNumber),
        contracts: [
            ...coreCalls,
            ...clmCalls,
            ...rewardPoolCalls,
            ...erc4626Calls,
            ...oracleFreshCalls,
            ...swapperBoostCalls,
            ...swapperRewardCalls,
            ...swapperUnderlyingCalls,
        ] as Parameters<typeof client.multicall>[0]['contracts'],
    });

    const [
        coreResults,
        clmResults,
        rewardPoolResults,
        erc4626Results,
        oracleFreshResults,
        swapperBoostResults,
        swapperRewardResults,
        swapperUnderlyingResults,
    ] = splitBatchResults(rawResults, [
        coreCalls.length,
        clmCalls.length,
        rewardPoolCalls.length,
        erc4626Calls.length,
        oracleFreshCalls.length,
        swapperBoostCalls.length,
        swapperRewardCalls.length,
        swapperUnderlyingCalls.length,
    ]) as [
        [
            MulticallResult<TotalSupplyResult>,
            MulticallResult<VaultUnderlyingBalanceResult>,
            MulticallResult<TotalSupplyResult>,
        ],
        [MulticallResult<TotalSupplyResult>, MulticallResult<ClmBalancesResult>],
        MulticallResult<TotalSupplyResult>[],
        MulticallResult<TotalSupplyResult>[],
        MulticallResult<FreshPriceResult>[],
        MulticallResult<SwapperAmountOutResult>[],
        MulticallResult<SwapperAmountOutResult>[],
        MulticallResult<SwapperAmountOutResult>[],
    ];

    const [vaultTotalSupplyRes, underlyingTokenBalanceRes, underlyingTokenTotalSupplyRes] = coreResults;
    const [clmManagerTotalSupplyRes, clmManagerBalancesRes] = clmResults;

    const erc4626Pairs = R.chunk(erc4626Results, 2);
    const erc4626AdapterTotalSupplyRes = erc4626Pairs.map(([totalSupplyRes]) => totalSupplyRes);
    const erc4626AdapterVaultSharesBalancesRes = erc4626Pairs.map(([, vaultSharesRes]) => vaultSharesRes);

    const nativeToUSDPriceBigInt = await fetchNativeToUSDPriceRaw(chainId, context.log, blockNumber);

    const clmFreshTailLen = hasClmUnderlying && clmUnderlyingToken0Address && clmUnderlyingToken1Address ? 2 : 0;
    const [, boostFreshResults, rewardFreshResults, underlyingFreshResults] = splitBatchResults(oracleFreshResults, [
        1,
        boostRewardTokens.length,
        rewardTokens.length,
        underlyingBreakdownTokens.length,
        clmFreshTailLen,
    ]) as [
        [MulticallResult<FreshPriceResult>],
        MulticallResult<FreshPriceResult>[],
        MulticallResult<FreshPriceResult>[],
        MulticallResult<FreshPriceResult>[],
        MulticallResult<FreshPriceResult>[],
    ];

    const boostFresh = parseBeefyOracleFreshPriceResults(boostFreshResults);
    const rewardFresh = parseBeefyOracleFreshPriceResults(rewardFreshResults);
    const underlyingFresh = parseBeefyOracleFreshPriceResults(underlyingFreshResults);

    const vaultTokenTotalSupply =
        vaultTotalSupplyRes?.status === 'success' ? (vaultTotalSupplyRes.result as bigint) : 0n;
    const underlyingAmount =
        underlyingTokenBalanceRes?.status === 'success' ? (underlyingTokenBalanceRes.result as bigint) : 0n;
    let vaultUnderlyingTotalSupply =
        underlyingTokenTotalSupplyRes?.status === 'success' ? (underlyingTokenTotalSupplyRes.result as bigint) : 0n;

    const rewardPoolsTotalSupply = rewardPoolResults.map((res) =>
        res?.status === 'success' ? (res.result as bigint) : 0n
    );
    const erc4626AdaptersTotalSupply = erc4626AdapterTotalSupplyRes.map((res) =>
        res?.status === 'success' ? (res.result as bigint) : 0n
    );
    const erc4626AdapterVaultSharesBalances = erc4626AdapterVaultSharesBalancesRes.map((res) =>
        res?.status === 'success' ? (res.result as bigint) : 0n
    );

    const boostRewardToNativePrices = parseBeefySwapperToNativePrices(
        swapperBoostResults,
        zipSameLength(boostRewardTokens, boostFresh).map(([token, freshPrice]) => ({
            decimals: token.decimals,
            freshPrice: oracleConfig ? freshPrice : undefined,
        }))
    );

    const rewardToNativePrices = parseBeefySwapperToNativePrices(
        swapperRewardResults,
        zipSameLength(rewardTokens, rewardFresh).map(([token, freshPrice]) => ({
            decimals: token.decimals,
            freshPrice: oracleConfig ? freshPrice : undefined,
        }))
    );

    const underlyingBreakdownToNativePrices = parseBeefySwapperToNativePrices(
        swapperUnderlyingResults,
        zipSameLength(underlyingBreakdownTokens, underlyingFresh).map(([token, freshPrice]) => ({
            decimals: token.decimals,
            freshPrice: oracleConfig ? freshPrice : undefined,
        }))
    );

    let underlyingToNativePrice = 0n;
    let vaultUnderlyingBreakdownBalances: bigint[] = [];

    if (
        hasClmUnderlying &&
        clmManagerTotalSupplyRes?.status === 'success' &&
        clmManagerBalancesRes?.status === 'success' &&
        clmUnderlyingToken0Decimals !== 0 &&
        clmUnderlyingToken1Decimals !== 0
    ) {
        const clmManagerTotalSupply = clmManagerTotalSupplyRes.result as bigint;
        vaultUnderlyingTotalSupply = clmManagerTotalSupply;
        const clmToken0Balance = (clmManagerBalancesRes.result as readonly [bigint, bigint])[0];
        const clmToken1Balance = (clmManagerBalancesRes.result as readonly [bigint, bigint])[1];
        vaultUnderlyingBreakdownBalances = [clmToken0Balance, clmToken1Balance];

        const token0Price = underlyingBreakdownToNativePrices[0] ?? 0n;
        const token1Price = underlyingBreakdownToNativePrices[1] ?? 0n;
        const totalNativeAmount0 = changeValueEncoding(
            clmToken0Balance * token0Price,
            clmUnderlyingToken0Decimals + 18,
            18
        );
        const totalNativeAmount1 = changeValueEncoding(
            clmToken1Balance * token1Price,
            clmUnderlyingToken1Decimals + 18,
            18
        );
        const totalNativeAmountInClm = totalNativeAmount0 + totalNativeAmount1;
        if (clmManagerTotalSupply > 0n) {
            underlyingToNativePrice = changeValueEncoding(
                (totalNativeAmountInClm * 10n ** 18n) / clmManagerTotalSupply,
                underlyingTokenDecimals,
                PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE
            );
        }
    } else {
        const breakdown = await getVaultTokenBreakdown({
            client,
            vaultAddress,
            strategyAddress,
            underlyingTokenAddress,
            underlyingPlatform,
            blockNumber,
        });

        for (const token of underlyingBreakdownTokens) {
            let rawBalance = 0n;
            for (const entry of breakdown) {
                if (normalizeHex(entry.tokenAddress) === normalizeHex(token.address)) {
                    rawBalance = entry.rawBalance;
                    break;
                }
            }
            vaultUnderlyingBreakdownBalances.push(rawBalance);
        }

        if (oracleConfig && normalizeHex(underlyingTokenAddress) === normalizeHex(oracleConfig.wrappedNativeAddress)) {
            underlyingToNativePrice = changeValueEncoding(1n, 0, PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE);
        } else if (underlyingAmount > 0n) {
            let totalNativeEquivalentAmount = 0n;
            for (let i = 0; i < underlyingBreakdownTokens.length; i++) {
                // biome-ignore lint/style/noNonNullAssertion: it's guaranteed to exist by construction
                const token = underlyingBreakdownTokens[i]!;
                const tokenBalance = vaultUnderlyingBreakdownBalances[i] ?? 0n;
                const tokenToNativePrice = underlyingBreakdownToNativePrices[i] ?? 0n;
                totalNativeEquivalentAmount += changeValueEncoding(
                    tokenBalance * tokenToNativePrice,
                    token.decimals + 18,
                    18
                );
            }
            underlyingToNativePrice = changeValueEncoding(
                (totalNativeEquivalentAmount * 10n ** BigInt(underlyingTokenDecimals)) / underlyingAmount,
                underlyingTokenDecimals,
                PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE
            );
        }
    }

    return {
        vaultTokenTotalSupply,
        vaultUnderlyingTotalSupply,
        vaultUnderlyingBreakdownBalances,
        rewardPoolsTotalSupply,
        erc4626AdaptersTotalSupply,
        erc4626AdapterVaultSharesBalances,
        underlyingAmount,
        underlyingToNativePrice,
        underlyingBreakdownToNativePrices,
        boostRewardToNativePrices,
        rewardToNativePrices,
        nativeToUSDPrice: nativeToUSDPriceBigInt,
    };
};

export const fetchClassicState = createEffect(
    {
        name: 'fetchClassicState',
        input: fetchClassicStateInputSchema,
        output: classicStateSchema,
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => fetchClassicStateRaw({ input, context })
);

export const fetchClassicStates = createEffect(
    {
        name: 'fetchClassicStates',
        input: S.schema({
            requests: S.array(fetchClassicStateInputSchema),
        }),
        output: S.schema({
            states: S.array(classicStateSchema),
        }),
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const states = await Promise.all(
            input.requests.map((request) => fetchClassicStateRaw({ input: request, context }))
        );
        return { states };
    }
);

export const detectClassicPlatform = createEffect(
    {
        name: 'detectClassicPlatform',
        input: {
            chainId: chainIdSchema,
            vaultAddress: hexSchema,
            strategyAddress: hexSchema,
            underlyingTokenAddress: hexSchema,
            underlyingPlatform: S.string,
        },
        output: {
            underlyingPlatform: S.string,
            breakdownTokenAddresses: S.array(hexSchema),
        },
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const client = getViemClient(input.chainId, context.log);
        const underlyingPlatform = await detectClassicVaultUnderlyingPlatform({
            client,
            vaultAddress: input.vaultAddress,
            strategyAddress: input.strategyAddress,
            underlyingTokenAddress: input.underlyingTokenAddress,
            underlyingPlatform: input.underlyingPlatform,
        });
        const breakdown = await getVaultTokenBreakdown({
            client,
            vaultAddress: input.vaultAddress,
            strategyAddress: input.strategyAddress,
            underlyingTokenAddress: input.underlyingTokenAddress,
            underlyingPlatform,
        });
        return {
            underlyingPlatform,
            breakdownTokenAddresses: breakdown.map((entry) => normalizeHex(entry.tokenAddress)),
        };
    }
);
