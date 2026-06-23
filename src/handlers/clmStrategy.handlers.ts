import type { ClmStrategy, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import { indexer } from 'envio';
import type { Hex } from 'viem';
import { fetchClmState, getClmStrategyInitData, parseFetchedClmState } from '../effects/clm.effects';
import { getClmStrategyManager } from '../effects/clmStrategy.effects';
import { getClmOrThrow, isClmInitialized, linkClmStrategy, setClmPausableStatus } from '../entities/clm.entity';
import { createClmHarvestEvent } from '../entities/clmHarvestEvent.entity';
import { createClmStrategy, getClmManager, getClmStrategy } from '../entities/clmManager.entity';
import { createClmManagerCollectionEvent } from '../entities/clmManagerCollectionEvent.entity';
import { createClmStrategyTvlEvent } from '../entities/clmStrategyTvlEvent.entity';
import { toChainId } from '../lib/chain';
import { ensureClmAggregate, maybeFinalizeClm } from '../lib/clm/init';
import { refreshClm, refreshClmFees } from '../lib/clm/refresh';
import { buildClmFetchInput, loadClmTokens } from '../lib/clm/tokens';
import { ADDRESS_ZERO, interpretAsDecimal } from '../lib/decimal';
import { normalizeHex } from '../lib/hex';

indexer.onEvent({ contract: 'ClmStrategy', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('ClmStrategy.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const strategyAddress = normalizeHex(event.srcAddress);
    const initializedBlock = event.block;

    const strategy = await initializeClmStrategy({ context, chainId, strategyAddress, initializedBlock });
    if (!strategy) return;

    const clm = await getClmOrThrow(context, strategy.clmManager_id);
    await maybeFinalizeClm({
        context,
        chainId,
        clm,
        strategy,
        timestamp: event.block.timestamp,
        blockNumber: event.block.number,
    });

    context.log.info('ClmStrategy initialized successfully', { strategyAddress });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'Harvest' }, async ({ event, context }) => {
    await handleClmHarvest({
        context,
        event,
        compoundedAmount0: event.params.fee0,
        compoundedAmount1: event.params.fee1,
        collectedOutputAmounts: [],
    });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'HarvestRewards' }, async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const strategy = await getClmStrategy(context, chainId, normalizeHex(event.srcAddress));
    if (!strategy) return;

    const clm = await getClmForStrategy({ context, strategy });
    const initData = await context.effect(getClmStrategyInitData, {
        strategyAddress: normalizeHex(strategy.address),
        chainId,
        blockNumber: event.block.number,
    });
    const collectedOutputAmounts = clm.outputTokensOrder.map((address) =>
        normalizeHex(address) === normalizeHex(initData.outputTokenAddress) ? event.params.fees : 0n
    );

    await handleClmHarvest({
        context,
        event,
        compoundedAmount0: 0n,
        compoundedAmount1: 0n,
        collectedOutputAmounts,
    });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'ClaimedFees' }, async ({ event, context }) => {
    await handleClmCollection({
        context,
        event,
        collectedAmount0: event.params.feeAlt0 + event.params.feeMain0,
        collectedAmount1: event.params.feeAlt1 + event.params.feeMain1,
        collectedOutputAmounts: [],
    });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'ClaimedRewards' }, async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const strategy = await getClmStrategy(context, chainId, normalizeHex(event.srcAddress));
    if (!strategy) return;

    const clm = await getClmForStrategy({ context, strategy });
    const initData = await context.effect(getClmStrategyInitData, {
        strategyAddress: normalizeHex(strategy.address),
        chainId,
        blockNumber: event.block.number,
    });
    const collectedOutputAmounts = clm.outputTokensOrder.map((address) =>
        normalizeHex(address) === normalizeHex(initData.outputTokenAddress) ? event.params.fees : 0n
    );

    await handleClmCollection({
        context,
        event,
        collectedAmount0: 0n,
        collectedAmount1: 0n,
        collectedOutputAmounts,
    });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'ChargedFeesV2' }, async ({ event, context }) => {
    await handleClmChargedFees({
        context,
        event,
        callFees: event.params.callFeeAmount,
        beefyFees: event.params.beefyFeeAmount,
        strategistFees: event.params.strategistFeeAmount,
    });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'ChargedFees' }, async ({ event, context }) => {
    if ('callFeeAmount' in event.params) {
        return;
    }

    await handleClmChargedFees({
        context,
        event,
        callFees: 0n,
        beefyFees: event.params.beefyFee,
        strategistFees: event.params.liquidityFee,
    });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'TVL' }, async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const strategyAddress = normalizeHex(event.srcAddress);
    const strategy = await getClmStrategy(context, chainId, strategyAddress);
    if (!strategy) return;

    const clm = await getClmOrThrow(context, strategy.clmManager_id);
    if (!clm) return;

    const tokenContext = await loadClmTokens({ context, clm });

    await createClmStrategyTvlEvent({
        context,
        chainId,
        clm,
        strategy,
        underlyingAmount0: interpretAsDecimal(event.params.bal0, tokenContext.underlyingToken0.decimals),
        underlyingAmount1: interpretAsDecimal(event.params.bal1, tokenContext.underlyingToken1.decimals),
        event: {
            block: event.block,
            trxIndex: event.transaction.transactionIndex,
            logIndex: event.logIndex,
            trxHash: normalizeHex(event.transaction.hash),
        },
    });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'Paused' }, async ({ event, context }) => {
    await updateClmPauseStatus({ context, event, pausableStatus: 'PAUSED' });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'Unpaused' }, async ({ event, context }) => {
    await updateClmPauseStatus({ context, event, pausableStatus: 'RUNNING' });
});

const initializeClmStrategy = async ({
    context,
    chainId,
    strategyAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    strategyAddress: Hex;
    initializedBlock: EvmBlock;
}): Promise<ClmStrategy | null> => {
    const existingStrategy = await getClmStrategy(context, chainId, strategyAddress);
    if (existingStrategy) {
        return existingStrategy;
    }

    context.log.info('Initializing ClmStrategy', { strategyAddress, chainId });

    const { managerAddress } = await context.effect(getClmStrategyManager, {
        strategyAddress,
        chainId,
        blockNumber: initializedBlock.number,
    });

    if (managerAddress === ADDRESS_ZERO) {
        context.log.error('ClmStrategy manager address is zero', { strategyAddress, chainId });
        return null;
    }

    const clmManager = await getClmManager(context, chainId, managerAddress);
    if (!clmManager) {
        context.log.warn('ClmManager not found for ClmStrategy', { strategyAddress, managerAddress, chainId });
        return null;
    }

    await ensureClmAggregate({ context, chainId, manager: clmManager, initializedBlock });

    const strategy = await createClmStrategy({
        context,
        chainId,
        strategyAddress,
        clmManager,
        initializedBlock,
    });

    const clm = await getClmOrThrow(context, clmManager.id);
    await linkClmStrategy({ context, clm, strategy });

    return strategy;
};

const getClmForStrategy = async ({ context, strategy }: { context: EvmOnEventContext; strategy: ClmStrategy }) => {
    return await getClmOrThrow(context, strategy.clmManager_id);
};

const handleClmHarvest = async ({
    context,
    event,
    compoundedAmount0,
    compoundedAmount1,
    collectedOutputAmounts,
}: {
    context: EvmOnEventContext;
    event: {
        srcAddress: Hex;
        block: EvmBlock;
        logIndex: number;
        transaction: { hash: string; transactionIndex: number };
    };
    compoundedAmount0: bigint;
    compoundedAmount1: bigint;
    collectedOutputAmounts: bigint[];
}) => {
    const chainId = toChainId(context.chain.id);
    const strategy = await getClmStrategy(context, chainId, normalizeHex(event.srcAddress));
    if (!strategy) return;

    const clm = await getClmForStrategy({ context, strategy });
    if (!isClmInitialized(clm)) return;

    const tokenContext = await loadClmTokens({ context, clm });
    const rawState = await context.effect(
        fetchClmState,
        buildClmFetchInput({ clm, tokens: tokenContext, blockNumber: event.block.number })
    );
    const state = parseFetchedClmState(rawState, tokenContext);

    await createClmHarvestEvent({
        context,
        chainId,
        clm,
        strategy,
        state,
        compoundedAmount0: interpretAsDecimal(compoundedAmount0, tokenContext.underlyingToken0.decimals),
        compoundedAmount1: interpretAsDecimal(compoundedAmount1, tokenContext.underlyingToken1.decimals),
        collectedOutputAmounts: collectedOutputAmounts.map((amount, index) =>
            interpretAsDecimal(amount, tokenContext.outputTokens[index]?.decimals ?? 18)
        ),
        event: {
            block: event.block,
            trxIndex: event.transaction.transactionIndex,
            logIndex: event.logIndex,
            trxHash: normalizeHex(event.transaction.hash),
        },
    });

    await refreshClm({
        context,
        clm,
        state,
        timestamp: event.block.timestamp,
    });
};

const handleClmCollection = async ({
    context,
    event,
    collectedAmount0,
    collectedAmount1,
    collectedOutputAmounts,
}: {
    context: EvmOnEventContext;
    event: {
        srcAddress: Hex;
        block: EvmBlock;
        logIndex: number;
        transaction: { hash: string; transactionIndex: number };
    };
    collectedAmount0: bigint;
    collectedAmount1: bigint;
    collectedOutputAmounts: bigint[];
}) => {
    const chainId = toChainId(context.chain.id);
    const strategy = await getClmStrategy(context, chainId, normalizeHex(event.srcAddress));
    if (!strategy) return;

    const clm = await getClmForStrategy({ context, strategy });
    if (!isClmInitialized(clm)) return;

    const tokenContext = await loadClmTokens({ context, clm });
    const rawState = await context.effect(
        fetchClmState,
        buildClmFetchInput({ clm, tokens: tokenContext, blockNumber: event.block.number })
    );
    const state = parseFetchedClmState(rawState, tokenContext);

    await createClmManagerCollectionEvent({
        context,
        chainId,
        clm,
        strategy,
        state,
        collectedAmount0: interpretAsDecimal(collectedAmount0, tokenContext.underlyingToken0.decimals),
        collectedAmount1: interpretAsDecimal(collectedAmount1, tokenContext.underlyingToken1.decimals),
        collectedOutputAmounts: collectedOutputAmounts.map((amount, index) =>
            interpretAsDecimal(amount, tokenContext.outputTokens[index]?.decimals ?? 18)
        ),
        event: {
            block: event.block,
            trxIndex: event.transaction.transactionIndex,
            logIndex: event.logIndex,
            trxHash: normalizeHex(event.transaction.hash),
        },
    });

    await refreshClm({
        context,
        clm,
        state,
        timestamp: event.block.timestamp,
    });
};

const handleClmChargedFees = async ({
    context,
    event,
    callFees,
    beefyFees,
    strategistFees,
}: {
    context: EvmOnEventContext;
    event: {
        srcAddress: Hex;
        block: EvmBlock;
    };
    callFees: bigint;
    beefyFees: bigint;
    strategistFees: bigint;
}) => {
    const chainId = toChainId(context.chain.id);
    const strategy = await getClmStrategy(context, chainId, normalizeHex(event.srcAddress));
    if (!strategy) return;

    const clm = await getClmForStrategy({ context, strategy });
    if (!isClmInitialized(clm)) return;

    const tokenContext = await loadClmTokens({ context, clm });

    await refreshClmFees({
        context,
        clm,
        callFees: interpretAsDecimal(callFees, tokenContext.managerToken.decimals),
        beefyFees: interpretAsDecimal(beefyFees, tokenContext.managerToken.decimals),
        strategistFees: interpretAsDecimal(strategistFees, tokenContext.managerToken.decimals),
        timestamp: event.block.timestamp,
    });
};

const updateClmPauseStatus = async ({
    context,
    event,
    pausableStatus,
}: {
    context: EvmOnEventContext;
    event: { srcAddress: Hex };
    pausableStatus: 'RUNNING' | 'PAUSED';
}) => {
    const chainId = toChainId(context.chain.id);
    const strategy = await getClmStrategy(context, chainId, normalizeHex(event.srcAddress));
    if (!strategy) return;

    const clm = await getClmForStrategy({ context, strategy });
    await setClmPausableStatus({ context, clm, pausableStatus });
};
