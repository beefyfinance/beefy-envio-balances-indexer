import type { Clm, ClmManager, ClmStrategy, EvmChainId, EvmOnEventContext } from 'envio';
import type { Hex } from 'viem';
import {
    fetchClmState,
    getClmManagerStrategy,
    getClmStrategyInitData,
    parseFetchedClmState,
} from '../../effects/clm.effects';
import {
    finalizeClmInitialization,
    getClm,
    getOrCreateClm,
    isClmInitialized,
    linkClmStrategy,
} from '../../entities/clm.entity';
import { getOrCreateToken } from '../../entities/token.entity';
import { ADDRESS_ZERO } from '../../lib/decimal';
import { normalizeHex } from '../../lib/hex';
import { refreshClm } from './refresh';
import { buildClmFetchInput, loadClmTokens } from './tokens';

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
    return await getOrCreateClm({
        context,
        chainId,
        managerAddress: normalizeHex(manager.address),
        clmManager: manager,
        initializedBlock,
    });
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

    const { strategyAddress } = await context.effect(getClmManagerStrategy, {
        managerAddress: normalizeHex(clm.address),
        chainId,
        blockNumber,
    });

    if (strategyAddress === ADDRESS_ZERO) {
        context.log.error('ClmManager strategy address is zero', { clmId: clm.id });
        return clm;
    }

    const strategy = await context.ClmStrategy.get(`${chainId}-${normalizeHex(strategyAddress)}`);
    if (!strategy) {
        context.Clm.set({ ...clm, clmStrategy_id: `${chainId}-${normalizeHex(strategyAddress)}` });
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
        strategyAddress: normalizeHex(strategy.address),
        chainId,
        blockNumber,
    });

    const outputToken =
        initData.outputTokenAddress === ADDRESS_ZERO
            ? null
            : await getOrCreateToken({
                  context,
                  chainId,
                  tokenAddress: normalizeHex(initData.outputTokenAddress),
                  virtual: false,
              });

    await finalizeClmInitialization({
        context,
        clm,
        underlyingProtocolPool: initData.underlyingProtocolPool,
        outputToken,
    });

    const finalizedClm = (await getClm(context, chainId, normalizeHex(clm.address))) as Clm;
    const tokenContext = await loadClmTokens({ context, clm: finalizedClm });
    const rawState = await context.effect(
        fetchClmState,
        buildClmFetchInput({ clm: finalizedClm, tokens: tokenContext, blockNumber })
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
    stakedTokenAddress: Hex;
}) => {
    const manager = await context.ClmManager.get(`${chainId}-${normalizeHex(stakedTokenAddress)}`);
    return manager !== undefined;
};
