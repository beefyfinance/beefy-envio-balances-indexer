import { indexer } from 'envio';
import './clock.handlers';
import { fetchClmState, parseFetchedClmState } from '../effects/clm.effects';
import { getOrCreateAccount } from '../entities/account.entity';
import { getClm } from '../entities/clm.entity';
import { createClmDepositEvent } from '../entities/clmDepositEvent.entity';
import { createClmWithdrawEvent } from '../entities/clmWithdrawEvent.entity';
import { getTokenOrThrow } from '../entities/token.entity';
import { toChainId } from '../lib/chain';
import {
    ensureClmAggregate,
    initializeClmManager,
    maybeFinalizeClm,
    maybeLinkClmStrategyFromManager,
} from '../lib/clm/init';
import { handleClmManagerTransfer } from '../lib/clm/position';
import { refreshClm } from '../lib/clm/refresh';
import { buildClmFetchInput, loadClmTokens } from '../lib/clm/tokens';
import { interpretAsDecimal } from '../lib/decimal';
import { toBytes } from '../lib/hex';
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

        await refreshClm({
            context,
            clm,
            state,
            timestamp: event.block.timestamp,
        });

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
