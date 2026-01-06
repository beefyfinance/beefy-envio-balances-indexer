import { type Block_t, RewardPool } from 'generated';
import type { RewardPool_t } from 'generated/src/db/Entities.gen';
import type { HandlerContext } from 'generated/src/Types';
import type { Hex } from 'viem';
import { getRewardPoolTokens } from '../effects/rewardPool.effects';
import { createPoolRewardedEvent } from '../entities/poolRewarded.event';
import { createRewardPool, getRewardPool } from '../entities/rewardPool.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { type ChainId, toChainId } from '../lib/chain';
import { handleTokenTransfer } from '../lib/token';

RewardPool.Initialized.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const rewardPoolAddress = event.srcAddress.toString().toLowerCase() as Hex;
    const initializedBlock = event.block;

    const rewardPool = await initializeRewardPool({ context, chainId, rewardPoolAddress, initializedBlock });
    if (!rewardPool) return;

    context.log.info('ClassicRewardPool initialized successfully', { rewardPoolAddress });
});

RewardPool.Transfer.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const rewardPoolAddress = event.srcAddress.toString().toLowerCase() as Hex;

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

RewardPool.NotifyReward.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const rewardPoolAddress = event.srcAddress.toString().toLowerCase() as Hex;
    const trxHash = event.transaction.hash.toString().toLowerCase() as Hex;
    const logIndex = event.logIndex;

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
        trxHash,
        logIndex,
        poolShareToken: shareToken,
        rewardToken: rewardToken,
        rewardVestingSeconds: event.params.duration,
        rawRewardAmount: event.params.amount,
        block: event.block,
    });
});

const initializeRewardPool = async ({
    context,
    chainId,
    rewardPoolAddress,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    rewardPoolAddress: Hex;
    initializedBlock: Block_t;
}): Promise<RewardPool_t | null> => {
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
