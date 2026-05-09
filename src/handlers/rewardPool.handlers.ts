import type { EvmBlock, EvmChainId, EvmOnEventContext, RewardPool } from 'envio';
import { indexer } from 'envio';
import type { Hex } from 'viem';
import { getRewardPoolTokens } from '../effects/rewardPool.effects';
import { createPoolRewardedEvent } from '../entities/poolRewarded.event';
import { createRewardPool, getRewardPool } from '../entities/rewardPool.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { normalizeHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'RewardPool', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('RewardPool.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const rewardPoolAddress = normalizeHex(event.srcAddress);
    const initializedBlock = event.block;

    const rewardPool = await initializeRewardPool({ context, chainId, rewardPoolAddress, initializedBlock });
    if (!rewardPool) return;

    context.log.info('ClassicRewardPool initialized successfully', { rewardPoolAddress });
});

indexer.onEvent({ contract: 'RewardPool', event: 'Transfer' }, async ({ event, context }) => {
    context.log.debug('RewardPool.Transfer', { event });

    const chainId = toChainId(context.chain.id);
    const rewardPoolAddress = normalizeHex(event.srcAddress);

    // Ensure that the reward pool is initialized first
    const rewardPool = await initializeRewardPool({
        context,
        chainId,
        rewardPoolAddress,
        initializedBlock: event.block,
    });
    if (!rewardPool) return;

    const shareToken = await getTokenOrThrow({ context, id: rewardPool.shareToken_id });

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

indexer.onEvent({ contract: 'RewardPool', event: 'NotifyReward' }, async ({ event, context }) => {
    context.log.debug('RewardPool.NotifyReward', { event });

    const chainId = toChainId(context.chain.id);
    const rewardPoolAddress = normalizeHex(event.srcAddress);

    const rewardPool = await initializeRewardPool({
        context,
        chainId,
        rewardPoolAddress,
        initializedBlock: event.block,
    });
    if (!rewardPool) return;

    const [shareToken, rewardToken] = await Promise.all([
        getTokenOrThrow({ context, id: rewardPool.shareToken_id }),
        getTokenOrThrow({ context, id: rewardPool.underlyingToken_id }),
    ]);

    await createPoolRewardedEvent({
        context,
        chainId,
        poolShareToken: shareToken,
        rewardToken: rewardToken,
        rewardVestingSeconds: event.params.duration,
        rawRewardAmount: event.params.amount,
        event: {
            block: event.block,
            trxIndex: event.transaction.transactionIndex,
            logIndex: event.logIndex,
            trxHash: normalizeHex(event.transaction.hash),
        },
    });
});

const initializeRewardPool = async ({
    context,
    chainId,
    rewardPoolAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    rewardPoolAddress: Hex;
    initializedBlock: EvmBlock;
}): Promise<RewardPool | null> => {
    // Check if the reward pool already exists
    const existingRewardPool = await getRewardPool(context, chainId, rewardPoolAddress);
    if (existingRewardPool) {
        return existingRewardPool;
    }

    context.log.info('Initializing ClassicRewardPool', { rewardPoolAddress, chainId });

    // Fetch underlying tokens using effect
    const { shareTokenAddress, underlyingTokenAddress, blacklistStatus } = await context.effect(getRewardPoolTokens, {
        rewardPoolAddress,
        chainId,
    });

    if (blacklistStatus !== 'ok') {
        logBlacklistStatus(context.log, blacklistStatus, 'RewardPool', {
            contractAddress: rewardPoolAddress,
            shareTokenAddress,
            underlyingTokenAddress,
        });
        return null;
    }

    // Create tokens - share token is virtual for reward pool
    const [shareToken, underlyingToken] = await Promise.all([
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: shareTokenAddress,
            virtual: false,
        }),
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: underlyingTokenAddress,
            virtual: false,
        }),
    ]);

    // Create reward pool entity
    return await createRewardPool({
        context,
        chainId,
        rewardPoolAddress,
        shareToken,
        underlyingToken,
        initializedBlock,
    });
};
