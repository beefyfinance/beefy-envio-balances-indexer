import type { ClmManager, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import { indexer } from 'envio';
import './clock.handlers';
import { fetchClmState, parseFetchedClmState } from '../effects/clm.effects';
import { getClmManagerTokens } from '../effects/clmManager.effects';
import { getOrCreateAccount } from '../entities/account.entity';
import { getClm } from '../entities/clm.entity';
import { createClmDepositEvent } from '../entities/clmDepositEvent.entity';
import { createClmManager, getClmManager } from '../entities/clmManager.entity';
import { createClmWithdrawEvent } from '../entities/clmWithdrawEvent.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { ensureClmAggregate, maybeFinalizeClm, maybeLinkClmStrategyFromManager } from '../lib/clm/init';
import { handleClmManagerTransfer } from '../lib/clm/position';
import { buildClmFetchInput, loadClmTokens } from '../lib/clm/tokens';
import { interpretAsDecimal } from '../lib/decimal';
import { type Bytes, toBytes, toHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'ClmManager', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('ClmManager.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const managerAddress = toBytes(event.srcAddress);
    const initializedBlock = event.block;

    const manager = await initializeClmManager({ context, chainId, managerAddress, initializedBlock });
    if (!manager) return;

    let clm = await ensureClmAggregate({ context, chainId, manager, initializedBlock });
    clm = await maybeLinkClmStrategyFromManager({ context, chainId, clm, blockNumber: event.block.number });

    const strategy = clm.clmStrategy_id ? await context.ClmStrategy.get(clm.clmStrategy_id) : undefined;
    if (strategy) {
        await maybeFinalizeClm({
            context,
            chainId,
            clm,
            strategy,
            timestamp: event.block.timestamp,
            blockNumber: event.block.number,
        });
    }

    context.log.info('ClmManager initialized successfully', { managerAddress });
});

indexer.onEvent(
    {
        contract: 'ClmManager',
        event: 'Transfer',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('ClmManager.Transfer', { event });

        const chainId = toChainId(context.chain.id);
        const managerAddress = toBytes(event.srcAddress);

        const manager = await initializeClmManager({
            context,
            chainId,
            managerAddress,
            initializedBlock: event.block,
        });
        if (!manager) return;

        const shareToken = await getTokenOrThrow({ context, id: manager.shareToken_id });

        await handleTokenTransfer({
            context,
            chainId,
            token: shareToken,
            senderAddress: toBytes(event.params.from),
            receiverAddress: toBytes(event.params.to),
            rawTransferAmount: event.params.value,
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });

        const clm = await getClm(context, chainId, managerAddress);
        if (!clm || clm.initializableStatus !== 'INITIALIZED' || !clm.clmStrategy_id) {
            return;
        }

        const tokenContext = await loadClmTokens({ context, clm });
        const rawState = await context.effect(
            fetchClmState,
            buildClmFetchInput({ clm, tokens: tokenContext, chainId, blockNumber: event.block.number })
        );
        const state = parseFetchedClmState(rawState, tokenContext);

        await handleClmManagerTransfer({
            context,
            chainId,
            clm,
            fromAddress: toBytes(event.params.from),
            toAddress: toBytes(event.params.to),
            transferAmount: interpretAsDecimal(event.params.value, tokenContext.managerToken.decimals),
            state,
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });
    }
);

indexer.onEvent(
    {
        contract: 'ClmManager',
        event: 'Deposit',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('ClmManager.Deposit', { event });

        const chainId = toChainId(context.chain.id);
        const managerAddress = toBytes(event.srcAddress);
        const clm = await getClm(context, chainId, managerAddress);
        if (!clm) return;

        const account = await getOrCreateAccount({ context, chainId, accountAddress: toBytes(event.params.user) });
        if (!account) return;

        const tokenContext = await loadClmTokens({ context, clm });

        await createClmDepositEvent({
            context,
            chainId,
            clm,
            account,
            shares: interpretAsDecimal(event.params.shares, tokenContext.managerToken.decimals),
            amount0: interpretAsDecimal(event.params.amount0, tokenContext.underlyingToken0.decimals),
            amount1: interpretAsDecimal(event.params.amount1, tokenContext.underlyingToken1.decimals),
            fee0: interpretAsDecimal(event.params.fee0, tokenContext.underlyingToken0.decimals),
            fee1: interpretAsDecimal(event.params.fee1, tokenContext.underlyingToken1.decimals),
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });
    }
);

indexer.onEvent(
    {
        contract: 'ClmManager',
        event: 'Withdraw',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('ClmManager.Withdraw', { event });

        const chainId = toChainId(context.chain.id);
        const managerAddress = toBytes(event.srcAddress);
        const clm = await getClm(context, chainId, managerAddress);
        if (!clm) return;

        const account = await getOrCreateAccount({ context, chainId, accountAddress: toBytes(event.params.user) });
        if (!account) return;

        const tokenContext = await loadClmTokens({ context, clm });

        await createClmWithdrawEvent({
            context,
            chainId,
            clm,
            account,
            shares: interpretAsDecimal(event.params.shares, tokenContext.managerToken.decimals),
            amount0: interpretAsDecimal(event.params.amount0, tokenContext.underlyingToken0.decimals),
            amount1: interpretAsDecimal(event.params.amount1, tokenContext.underlyingToken1.decimals),
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });
    }
);

const initializeClmManager = async ({
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
