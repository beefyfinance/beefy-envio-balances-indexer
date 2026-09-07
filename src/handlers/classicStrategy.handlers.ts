import type { ClassicVaultStrategy, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import { indexer } from 'envio';
import { fetchClassicState, parseFetchedClassicState } from '../effects/classic.effects';
import { getClassicStrategyVault } from '../effects/classicStrategy.effects';
import {
    getClassic,
    getClassicOrThrow,
    linkClassicVaultStrategy,
    setClassicPausableStatus,
} from '../entities/classic.entity';
import { createClassicHarvestEvent } from '../entities/classicHarvestEvent.entity';
import { createClassicVaultStrategy, getClassicVault, getClassicVaultStrategy } from '../entities/classicVault.entity';
import { toChainId } from '../lib/chain';
import { ensureClassicAggregate, maybeFinalizeClassic } from '../lib/classic/init';
import { refreshClassic, refreshClassicFees } from '../lib/classic/refresh';
import { buildClassicFetchInput, loadClassicTokens } from '../lib/classic/tokens';
import { interpretAsDecimal } from '../lib/decimal';
import { type Bytes, toBytes, toHex, ZERO_ADDRESS_HEX } from '../lib/hex';

indexer.onEvent({ contract: 'ClassicStrategy', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('ClassicStrategy.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const strategyAddress = toBytes(event.srcAddress);
    const initializedBlock = event.block;

    const strategy = await initializeClassicStrategy({ context, chainId, strategyAddress, initializedBlock });
    if (!strategy) return;

    const classicVault = await context.ClassicVault.get(strategy.classicVault_id);
    if (!classicVault) {
        context.log.warn('ClassicVault not found for strategy initialization', { strategyAddress });
        return;
    }

    let classic = await ensureClassicAggregate({ context, chainId, classicVault, initializedBlock });
    await linkClassicVaultStrategy({ context, classic, strategy });
    classic = await getClassicOrThrow(context, classic.id);

    await maybeFinalizeClassic({
        context,
        chainId,
        classic,
        strategy,
        timestamp: event.block.timestamp,
        blockNumber: event.block.number,
    });

    context.log.info('ClassicStrategy initialized successfully', { strategyAddress });
});

indexer.onEvent(
    {
        contract: 'ClassicStrategyStratHarvest0',
        event: 'StratHarvest',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        await handleClassicStrategyHarvest({ event, context, compoundedAmount: event.params.wantHarvested });
    }
);

indexer.onEvent(
    {
        contract: 'ClassicStrategyStratHarvest1',
        event: 'StratHarvest',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        await handleClassicStrategyHarvest({ event, context, compoundedAmount: event.params.wantHarvested });
    }
);

indexer.onEvent({ contract: 'ClassicStrategy', event: 'ChargedFees' }, async ({ event, context }) => {
    await handleClassicStrategyChargedFees({
        event,
        context,
        callFees: 0n,
        beefyFees: event.params.beefyFee,
        strategistFees: event.params.liquidityFee,
    });
});

indexer.onEvent({ contract: 'ClassicStrategy', event: 'ChargedFeesV2' }, async ({ event, context }) => {
    await handleClassicStrategyChargedFees({
        event,
        context,
        callFees: event.params.callFees,
        beefyFees: event.params.beefyFees,
        strategistFees: event.params.strategistFees,
    });
});

indexer.onEvent({ contract: 'ClassicStrategy', event: 'Paused' }, async ({ event, context }) => {
    await handleClassicStrategyPauseChange({ event, context, pausableStatus: 'PAUSED' });
});

indexer.onEvent({ contract: 'ClassicStrategy', event: 'Unpaused' }, async ({ event, context }) => {
    await handleClassicStrategyPauseChange({ event, context, pausableStatus: 'RUNNING' });
});

const handleClassicStrategyHarvest = async ({
    event,
    context,
    compoundedAmount,
}: {
    event: {
        srcAddress: string;
        block: EvmBlock;
        transaction: { transactionIndex: number; hash: string };
        logIndex: number;
        params: { wantHarvested: bigint };
    };
    context: EvmOnEventContext;
    compoundedAmount: bigint;
}) => {
    const chainId = toChainId(context.chain.id);
    const strategyAddress = toBytes(event.srcAddress);
    const strategy = await getClassicVaultStrategy(context, chainId, strategyAddress);
    if (!strategy) return;

    const classicVault = await context.ClassicVault.get(strategy.classicVault_id);
    if (!classicVault) return;
    const classic = await getClassic(context, chainId, classicVault.address);
    if (!classic || classic.initializableStatus !== 'INITIALIZED') return;

    const tokenContext = await loadClassicTokens({ context, classic });
    const fetchInput = await buildClassicFetchInput({
        context,
        chainId,
        classic,
        tokens: tokenContext,
        blockNumber: event.block.number,
    });
    const rawState = await context.effect(fetchClassicState, fetchInput);
    const state = parseFetchedClassicState(rawState, tokenContext);

    await createClassicHarvestEvent({
        context,
        chainId,
        classic,
        strategy,
        state,
        compoundedAmount: interpretAsDecimal(compoundedAmount, tokenContext.underlyingToken.decimals),
        event: {
            block: event.block,
            trxIndex: event.transaction.transactionIndex,
            logIndex: event.logIndex,
            trxHash: toBytes(event.transaction.hash),
        },
    });

    await refreshClassic({
        context,
        classic,
        state,
        timestamp: event.block.timestamp,
    });
};

const handleClassicStrategyChargedFees = async ({
    event,
    context,
    callFees,
    beefyFees,
    strategistFees,
}: {
    event: { srcAddress: string; block: EvmBlock };
    context: EvmOnEventContext;
    callFees: bigint;
    beefyFees: bigint;
    strategistFees: bigint;
}) => {
    const chainId = toChainId(context.chain.id);
    const strategyAddress = toBytes(event.srcAddress);
    const strategy = await getClassicVaultStrategy(context, chainId, strategyAddress);
    if (!strategy) return;

    const classicVault = await context.ClassicVault.get(strategy.classicVault_id);
    if (!classicVault) return;
    const classic = await getClassic(context, chainId, classicVault.address);
    if (!classic || classic.initializableStatus !== 'INITIALIZED') return;

    const tokenContext = await loadClassicTokens({ context, classic });
    await refreshClassicFees({
        context,
        classic,
        callFees: interpretAsDecimal(callFees, tokenContext.underlyingToken.decimals),
        beefyFees: interpretAsDecimal(beefyFees, tokenContext.underlyingToken.decimals),
        strategistFees: interpretAsDecimal(strategistFees, tokenContext.underlyingToken.decimals),
        timestamp: event.block.timestamp,
    });
};

const handleClassicStrategyPauseChange = async ({
    event,
    context,
    pausableStatus,
}: {
    event: { srcAddress: string };
    context: EvmOnEventContext;
    pausableStatus: 'RUNNING' | 'PAUSED';
}) => {
    const chainId = toChainId(context.chain.id);
    const strategyAddress = toBytes(event.srcAddress);
    const strategy = await getClassicVaultStrategy(context, chainId, strategyAddress);
    if (!strategy) return;

    context.ClassicVaultStrategy.set({
        ...strategy,
        pausableStatus,
    });

    const classicVault = await context.ClassicVault.get(strategy.classicVault_id);
    if (!classicVault) return;
    const classic = await getClassic(context, chainId, classicVault.address);
    if (!classic) return;

    await setClassicPausableStatus({ context, classic, pausableStatus });
};

const initializeClassicStrategy = async ({
    context,
    chainId,
    strategyAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    strategyAddress: Bytes;
    initializedBlock: EvmBlock;
}): Promise<ClassicVaultStrategy | null> => {
    // Check if the strategy already exists
    const existingStrategy = await getClassicVaultStrategy(context, chainId, strategyAddress);
    if (existingStrategy) {
        return existingStrategy;
    }

    context.log.info('Initializing ClassicStrategy', { strategyAddress, chainId });

    // Fetch vault address using effect
    const { vaultAddress: vaultAddressStr } = await context.effect(getClassicStrategyVault, {
        strategyAddress: toHex(strategyAddress),
        chainId,
        blockNumber: initializedBlock.number,
    });

    if (vaultAddressStr === ZERO_ADDRESS_HEX) {
        context.log.error('ClassicStrategy vault address is zero', { strategyAddress, chainId });
        return null;
    }

    const vaultAddress = toBytes(vaultAddressStr);

    // Get the ClassicVault entity
    const classicVault = await getClassicVault(context, chainId, vaultAddress);
    if (!classicVault) {
        context.log.warn('ClassicVault not found for ClassicStrategy', { strategyAddress, vaultAddress, chainId });
        return null;
    }

    // Create ClassicVaultStrategy entity
    return await createClassicVaultStrategy({
        context,
        chainId,
        strategyAddress,
        classicVault,
        initializedBlock,
    });
};
