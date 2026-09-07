import type {
    Classic,
    ClassicBoost,
    ClassicErc4626Adapter,
    ClassicVault,
    ClassicVaultStrategy,
    EvmChainId,
    EvmOnEventContext,
    Token,
} from 'envio';
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
import { getOrCreateToken, getTokenOrThrow } from '../../entities/token.entity';
import { type Bytes, toBytes, toHex } from '../hex';
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
        vaultAddress: classicVault.address,
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

    const underlyingTokenEntity = await context.Token.get(classic.underlyingToken_id);
    if (!underlyingTokenEntity) {
        context.log.error('Classic underlying token not found during finalize', { classicId: classic.id });
        return classic;
    }

    const underlyingToken = await getOrCreateToken({
        context,
        chainId,
        tokenAddress: underlyingTokenEntity.address,
        virtual: false,
    });
    if (!underlyingToken) {
        context.log.error('Classic underlying token not found during finalize', { classicId: classic.id });
        return classic;
    }

    const platformData = await context.effect(detectClassicPlatform, {
        chainId,
        vaultAddress: toHex(classic.address),
        strategyAddress: toHex(strategy.address),
        underlyingTokenAddress: toHex(underlyingToken.address),
        underlyingPlatform: classic.underlyingPlatform,
    });

    const underlyingBreakdownTokens = await Promise.all(
        platformData.breakdownTokenAddresses.map((tokenAddress) =>
            getOrCreateToken({
                context,
                chainId,
                tokenAddress: toBytes(tokenAddress),
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
    stakedTokenAddress: Bytes;
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

export const tryLinkClassicBoost = async ({
    context,
    chainId,
    boost,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    boost: ClassicBoost;
}): Promise<ClassicBoost> => {
    if (boost.classic_id) {
        return boost;
    }

    const stakedToken = await getTokenOrThrow({ context, id: boost.underlyingToken_id });
    if (
        !(await isClassicVaultStakedToken({
            context,
            chainId,
            stakedTokenAddress: stakedToken.address,
        }))
    ) {
        return boost;
    }

    const classic = await getClassic(context, chainId, stakedToken.address);
    if (!classic) {
        return boost;
    }

    const rewardToken = await getTokenOrThrow({ context, id: boost.rewardToken_id });
    await linkClassicBoost({ context, classic, boost, rewardToken });

    return (await context.ClassicBoost.get(boost.id)) ?? boost;
};

export const tryLinkClassicErc4626Adapter = async ({
    context,
    chainId,
    adapter,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    adapter: ClassicErc4626Adapter;
}): Promise<ClassicErc4626Adapter> => {
    if (adapter.classic_id) {
        return adapter;
    }

    const underlyingToken = await getTokenOrThrow({ context, id: adapter.underlyingToken_id });
    if (
        !(await isClassicVaultStakedToken({
            context,
            chainId,
            stakedTokenAddress: underlyingToken.address,
        }))
    ) {
        return adapter;
    }

    const classic = await getClassic(context, chainId, underlyingToken.address);
    if (!classic) {
        return adapter;
    }

    const shareToken = await getTokenOrThrow({ context, id: adapter.shareToken_id });
    await linkClassicErc4626Adapter({ context, classic, adapterShareToken: shareToken });
    context.ClassicErc4626Adapter.set({ ...adapter, classic_id: classic.id });

    return (await context.ClassicErc4626Adapter.get(adapter.id)) ?? adapter;
};
