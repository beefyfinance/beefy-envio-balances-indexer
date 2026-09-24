import type { Clm, ClmManager, ClmStrategy, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import {
    fetchClmState,
    getClmManagerStrategy,
    getClmStrategyInitData,
    parseFetchedClmState,
} from '../../effects/clm.effects';
import { getClmManagerTokens } from '../../effects/clmManager.effects';
import {
    finalizeClmInitialization,
    getClm,
    getOrCreateClm,
    isClmInitialized,
    linkClmStrategy,
} from '../../entities/clm.entity';
import { createClmManager, getClmManager } from '../../entities/clmManager.entity';
import { getOrCreateToken } from '../../entities/token.entity';
import { logBlacklistStatus } from '../blacklist';
import { type Bytes, toBytes, toHex, ZERO_ADDRESS_HEX } from '../hex';
import { refreshClm } from './refresh';
import { buildClmFetchInput, loadClmTokens } from './tokens';

export const initializeClmManager = async ({
    context,
    chainId,
    managerAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    managerAddress: Bytes;
    initializedBlock: EvmBlock;
}): Promise<ClmManager | null> => {
    const existingManager = await getClmManager(context, chainId, managerAddress);
    if (existingManager) {
        return existingManager;
    }

    context.log.info('Initializing ClmManager', { managerAddress, chainId });

    const {
        shareTokenAddress: shareTokenAddressStr,
        underlyingToken0Address: underlyingToken0AddressStr,
        underlyingToken1Address: underlyingToken1AddressStr,
        blacklistStatus,
    } = await context.effect(getClmManagerTokens, {
        managerAddress: toHex(managerAddress),
        chainId,
    });
    const shareTokenAddress = toBytes(shareTokenAddressStr);
    const underlyingToken0Address = toBytes(underlyingToken0AddressStr);
    const underlyingToken1Address = toBytes(underlyingToken1AddressStr);

    if (blacklistStatus !== 'ok') {
        logBlacklistStatus(context.log, blacklistStatus, 'ClmManager', {
            contractAddress: managerAddress,
            shareTokenAddress,
            underlyingToken0Address,
            underlyingToken1Address,
        });
        return null;
    }

    const [shareToken, underlyingToken0, underlyingToken1] = await Promise.all([
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: shareTokenAddress,
            virtual: false,
        }),
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: underlyingToken0Address,
            virtual: false,
        }),
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: underlyingToken1Address,
            virtual: false,
        }),
    ]);

    if (!shareToken || !underlyingToken0 || !underlyingToken1) {
        logBlacklistStatus(context.log, 'maybe_blacklisted', 'ClmManager', {
            contractAddress: managerAddress,
            shareTokenAddress,
            underlyingToken0Address,
            underlyingToken1Address,
            reason: 'invalid_token_metadata',
        });
        return null;
    }

    const manager = await createClmManager({
        context,
        chainId,
        managerAddress,
        shareToken,
        underlyingToken0,
        underlyingToken1,
        initializedBlock,
    });

    await ensureClmAggregate({ context, chainId, manager, initializedBlock });
    return manager;
};

export const ensureClmAggregate = async ({
    context,
    chainId,
    manager,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    manager: ClmManager;
    initializedBlock: Parameters<typeof getOrCreateClm>[0]['initializedBlock'];
}) => {
    const clm = await getOrCreateClm({
        context,
        chainId,
        managerAddress: manager.address,
        clmManager: manager,
        initializedBlock,
    });

    context.ClmManager.set({
        ...manager,
        clm_id: clm.id,
    });

    return clm;
};

export const maybeLinkClmStrategyFromManager = async ({
    context,
    chainId,
    clm,
    blockNumber,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    blockNumber: number;
}) => {
    if (clm.clmStrategy_id) {
        return clm;
    }

    const { strategyAddress: strategyAddressStr } = await context.effect(getClmManagerStrategy, {
        managerAddress: toHex(clm.address),
        chainId,
        blockNumber,
    });

    if (strategyAddressStr === ZERO_ADDRESS_HEX) {
        context.log.error('ClmManager strategy address is zero', { clmId: clm.id });
        return clm;
    }

    const strategy = await context.ClmStrategy.get(`${chainId}-${strategyAddressStr}`);
    if (!strategy) {
        context.Clm.set({ ...clm, clmStrategy_id: `${chainId}-${strategyAddressStr}` });
        return (await context.Clm.get(clm.id)) as Clm;
    }

    await linkClmStrategy({ context, clm, strategy });
    return (await context.Clm.get(clm.id)) as Clm;
};

export const maybeFinalizeClm = async ({
    context,
    chainId,
    clm,
    strategy,
    timestamp,
    blockNumber,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    strategy: ClmStrategy;
    timestamp: number;
    blockNumber: number;
}) => {
    if (isClmInitialized(clm)) {
        return clm;
    }

    const initData = await context.effect(getClmStrategyInitData, {
        strategyAddress: toHex(strategy.address),
        chainId,
        blockNumber,
    });
    const outputTokenAddressStr = initData.outputTokenAddress;
    const underlyingProtocolPool = toBytes(initData.underlyingProtocolPool);

    const outputToken =
        outputTokenAddressStr === ZERO_ADDRESS_HEX
            ? null
            : await getOrCreateToken({
                  context,
                  chainId,
                  tokenAddress: toBytes(outputTokenAddressStr),
                  virtual: false,
              });

    await finalizeClmInitialization({
        context,
        clm,
        underlyingProtocolPool,
        outputToken,
    });

    const finalizedClm = (await getClm(context, chainId, clm.address)) as Clm;
    const tokenContext = await loadClmTokens({ context, clm: finalizedClm });
    const rawState = await context.effect(
        fetchClmState,
        buildClmFetchInput({ clm: finalizedClm, tokens: tokenContext, chainId, blockNumber })
    );
    const state = parseFetchedClmState(rawState, tokenContext);

    await refreshClm({
        context,
        clm: finalizedClm,
        state,
        timestamp,
    });

    return finalizedClm;
};

export const isClmManagerRewardPool = async ({
    context,
    chainId,
    stakedTokenAddress,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    stakedTokenAddress: Bytes;
}) => {
    const manager = await context.ClmManager.get(`${chainId}-${toHex(stakedTokenAddress)}`);
    return manager !== undefined;
};
