import type {
    Classic,
    ClassicBoost,
    ClassicVault,
    ClassicVaultStrategy,
    EvmChainId,
    EvmOnEventContext,
    Token,
} from 'envio';
import type { Hex } from 'viem';
import { detectClassicPlatform, fetchClassicState, parseFetchedClassicState } from '../../effects/classic.effects';
import {
    addClassicBoostRewardToken,
    finalizeClassicInitialization,
    getClassic,
    getOrCreateClassic,
    isClassicInitialized,
    isClassicVaultAddress,
    linkClassicErc4626Adapter,
    linkClassicRewardPool,
    linkClassicVaultStrategy,
} from '../../entities/classic.entity';
import { getOrCreateToken } from '../../entities/token.entity';
import { normalizeHex } from '../hex';
import { refreshClassic } from './refresh';
import { buildClassicFetchInput, loadClassicTokens } from './tokens';

export const ensureClassicAggregate = async ({
    context,
    chainId,
    classicVault,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classicVault: ClassicVault;
    initializedBlock: Parameters<typeof getOrCreateClassic>[0]['initializedBlock'];
}) => {
    const classic = await getOrCreateClassic({
        context,
        chainId,
        vaultAddress: normalizeHex(classicVault.address),
        classicVault,
        initializedBlock,
    });

    context.ClassicVault.set({
        ...classicVault,
        classic_id: classic.id,
    });

    return classic;
};

export const maybeLinkClassicStrategy = async ({
    context,
    chainId,
    classic,
    strategy,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    strategy: ClassicVaultStrategy;
}) => {
    if (classic.classicVaultStrategy_id) {
        return classic;
    }
    await linkClassicVaultStrategy({ context, classic, strategy });
    return (await getClassic(context, chainId, classic.address)) as Classic;
};

export const maybeFinalizeClassic = async ({
    context,
    chainId,
    classic,
    strategy,
    timestamp,
    blockNumber,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    strategy: ClassicVaultStrategy;
    timestamp: number;
    blockNumber: number;
}) => {
    if (isClassicInitialized(classic)) {
        return classic;
    }

    const underlyingToken = await getOrCreateToken({
        context,
        chainId,
        tokenAddress: (await context.Token.get(classic.underlyingToken_id))?.address as `0x${string}`,
        virtual: false,
    });
    if (!underlyingToken) {
        context.log.error('Classic underlying token not found during finalize', { classicId: classic.id });
        return classic;
    }

    const platformData = await context.effect(detectClassicPlatform, {
        chainId,
        vaultAddress: normalizeHex(classic.address),
        strategyAddress: normalizeHex(strategy.address),
        underlyingTokenAddress: normalizeHex(underlyingToken.address),
        underlyingPlatform: classic.underlyingPlatform,
    });

    const underlyingBreakdownTokens = await Promise.all(
        platformData.breakdownTokenAddresses.map((tokenAddress) =>
            getOrCreateToken({
                context,
                chainId,
                tokenAddress,
                virtual: false,
            })
        )
    );

    const validBreakdownTokens = underlyingBreakdownTokens.filter(
        (token): token is NonNullable<typeof token> => token !== null
    );

    await finalizeClassicInitialization({
        context,
        classic,
        underlyingPlatform: platformData.underlyingPlatform,
        underlyingBreakdownTokens: validBreakdownTokens,
    });

    const finalizedClassic = (await getClassic(context, chainId, classic.address)) as Classic;
    const tokenContext = await loadClassicTokens({ context, classic: finalizedClassic });
    const fetchInput = await buildClassicFetchInput({
        context,
        chainId,
        classic: finalizedClassic,
        tokens: tokenContext,
        blockNumber,
    });
    const rawState = await context.effect(fetchClassicState, fetchInput);
    const state = parseFetchedClassicState(rawState, tokenContext);

    await refreshClassic({
        context,
        classic: finalizedClassic,
        state,
        timestamp,
    });

    return finalizedClassic;
};

export const isClassicVaultStakedToken = async ({
    context,
    chainId,
    stakedTokenAddress,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    stakedTokenAddress: Hex;
}) => isClassicVaultAddress(context, chainId, stakedTokenAddress);

export const linkClassicBoost = async ({
    context,
    classic,
    boost,
    rewardToken,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    boost: ClassicBoost;
    rewardToken: Token;
}) => {
    context.ClassicBoost.set({
        ...boost,
        classic_id: classic.id,
    });

    await addClassicBoostRewardToken({ context, classic, rewardToken });
};

export const linkClassicRewardPoolToClassic = async ({
    context,
    chainId,
    classic,
    rewardPoolShareToken,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    rewardPoolShareToken: Token;
}) => {
    await linkClassicRewardPool({ context, classic, rewardPoolShareToken });
    return (await getClassic(context, chainId, classic.address)) as Classic;
};

export const linkClassicErc4626AdapterToClassic = async ({
    context,
    chainId,
    classic,
    adapterShareToken,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    adapterShareToken: Token;
}) => {
    await linkClassicErc4626Adapter({ context, classic, adapterShareToken });
    return (await getClassic(context, chainId, classic.address)) as Classic;
};
