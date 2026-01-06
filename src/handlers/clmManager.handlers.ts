import { type Block_t, ClmManager } from 'generated';
import type { ClmManager_t } from 'generated/src/db/Entities.gen';
import type { HandlerContext } from 'generated/src/Types';
import type { Hex } from 'viem';
import { getClmManagerTokens } from '../effects/clmManager.effects';
import { createClmManager, getClmManager } from '../entities/clmManager.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { type ChainId, toChainId } from '../lib/chain';
import { handleTokenTransfer } from '../lib/token';

ClmManager.Initialized.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const managerAddress = event.srcAddress.toString().toLowerCase() as Hex;
    const initializedBlock = event.block;

    const manager = await initializeClmManager({ context, chainId, managerAddress, initializedBlock });
    if (!manager) return;

    context.log.info('ClmManager initialized successfully', { managerAddress });
});

ClmManager.Transfer.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const managerAddress = event.srcAddress.toString().toLowerCase() as Hex;

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
        senderAddress: event.params.from.toString().toLowerCase() as Hex,
        receiverAddress: event.params.to.toString().toLowerCase() as Hex,
        rawTransferAmount: event.params.value,
        event: {
            block: event.block,
            logIndex: event.logIndex,
            trxHash: event.transaction.hash.toString().toLowerCase() as Hex,
        },
    });
});

const initializeClmManager = async ({
    context,
    chainId,
    managerAddress,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    managerAddress: Hex;
    initializedBlock: Block_t;
}): Promise<ClmManager_t | null> => {
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
