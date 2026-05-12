import type { ClmManager, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import { indexer } from 'envio';
import type { Hex } from 'viem';
import { getClmManagerTokens } from '../effects/clmManager.effects';
import { createClmManager, getClmManager } from '../entities/clmManager.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { normalizeHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'ClmManager', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('ClmManager.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const managerAddress = normalizeHex(event.srcAddress);
    const initializedBlock = event.block;

    const manager = await initializeClmManager({ context, chainId, managerAddress, initializedBlock });
    if (!manager) return;

    context.log.info('ClmManager initialized successfully', { managerAddress });
});

indexer.onEvent({ contract: 'ClmManager', event: 'Transfer' }, async ({ event, context }) => {
    context.log.debug('ClmManager.Transfer', { event });

    const chainId = toChainId(context.chain.id);
    const managerAddress = normalizeHex(event.srcAddress);

    // Ensure that the manager is initialized first
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
        senderAddress: normalizeHex(event.params.from),
        receiverAddress: normalizeHex(event.params.to),
        rawTransferAmount: event.params.value,
        event: {
            block: event.block,
            trxIndex: event.transaction.transactionIndex,
            logIndex: event.logIndex,
            trxHash: normalizeHex(event.transaction.hash),
        },
    });
});

const initializeClmManager = async ({
    context,
    chainId,
    managerAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    managerAddress: Hex;
    initializedBlock: EvmBlock;
}): Promise<ClmManager | null> => {
    // Check if the manager already exists
    const existingManager = await getClmManager(context, chainId, managerAddress);
    if (existingManager) {
        return existingManager;
    }

    context.log.info('Initializing ClmManager', { managerAddress, chainId });

    // Fetch underlying tokens using effect
    const { shareTokenAddress, underlyingToken0Address, underlyingToken1Address, blacklistStatus } =
        await context.effect(getClmManagerTokens, {
            managerAddress,
            chainId,
        });

    if (blacklistStatus !== 'ok') {
        logBlacklistStatus(context.log, blacklistStatus, 'ClmManager', {
            contractAddress: managerAddress,
            shareTokenAddress,
            underlyingToken0Address,
            underlyingToken1Address,
        });
        return null;
    }

    // Create tokens - share token is virtual for CLM manager
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

    // Create CLM manager entity
    return await createClmManager({
        context,
        chainId,
        managerAddress,
        shareToken,
        underlyingToken0,
        underlyingToken1,
        initializedBlock,
    });
};
