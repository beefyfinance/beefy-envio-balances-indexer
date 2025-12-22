import { type Block_t, ClassicBoost } from 'generated';
import type { ClassicBoost_t } from 'generated/src/db/Entities.gen';
import type { HandlerContext } from 'generated/src/Types';
import type { Hex } from 'viem';
import { getClassicBoostTokens } from '../effects/classicBoost.effects';
import { createClassicBoost, getClassicBoost } from '../entities/classicBoost.entity';
import { createPoolRewardedEvent } from '../entities/poolRewarded.event';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { type ChainId, toChainId } from '../lib/chain';
import { config } from '../lib/config';
import { handleTokenTransfer } from '../lib/token';

ClassicBoost.Initialized.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const boostAddress = event.srcAddress.toString().toLowerCase() as Hex;
    const initializedBlock = event.block;

    const boost = await initializeBoost({ context, chainId, boostAddress, initializedBlock });
    if (!boost) return;

    context.log.info('ClassicBoost initialized successfully', { boostAddress });
});

ClassicBoost.Staked.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const boostAddress = event.srcAddress.toString().toLowerCase() as Hex;
    const initializedBlock = event.block;

    // Ensure that the boost virtual token is created first
    // otherwise, handleTokenTransfer will try and create it and fail because
    // it's not aware it is being virtual
    const boost = await initializeBoost({ context, chainId, boostAddress, initializedBlock });
    if (!boost) return;

    const shareToken = await getTokenOrThrow({ context, id: boost.shareToken_id });

    await handleTokenTransfer({
        context,
        chainId,
        token: shareToken,
        senderAddress: config.MINT_ADDRESS,
        receiverAddress: event.params.user.toString().toLowerCase() as Hex,
        rawTransferAmount: event.params.amount,
        block: event.block,
        transaction: event.transaction,
    });
});

ClassicBoost.Withdrawn.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const boostAddress = event.srcAddress.toString().toLowerCase() as Hex;

    const boost = await initializeBoost({
        context,
        chainId,
        boostAddress,
        initializedBlock: event.block,
    });
    if (!boost) return;

    const shareToken = await getTokenOrThrow({ context, id: boost.shareToken_id });

    await handleTokenTransfer({
        context,
        chainId,
        token: shareToken,
        senderAddress: event.params.user.toString().toLowerCase() as Hex,
        receiverAddress: config.BURN_ADDRESS,
        rawTransferAmount: event.params.amount,
        block: event.block,
        transaction: event.transaction,
    });
});

ClassicBoost.RewardAdded.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const boostAddress = event.srcAddress.toString().toLowerCase() as Hex;

    const boost = await initializeBoost({
        context,
        chainId,
        boostAddress,
        initializedBlock: event.block,
    });
    if (!boost) return;

    const trxHash = event.transaction.hash.toString().toLowerCase() as Hex;
    const logIndex = event.logIndex;

    const [shareToken, rewardToken] = await Promise.all([
        getTokenOrThrow({ context, id: boost.shareToken_id }),
        getTokenOrThrow({ context, id: boost.underlyingToken_id }),
    ]);

    await createPoolRewardedEvent({
        context,
        chainId,
        trxHash,
        logIndex,
        poolShareToken: shareToken,
        rewardToken: rewardToken,
        rewardVestingSeconds: 0n, // boost rewards are immediate
        rawRewardAmount: event.params.reward,
        block: event.block,
    });
});

const initializeBoost = async ({
    context,
    chainId,
    boostAddress,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    boostAddress: Hex;
    initializedBlock: Block_t;
}): Promise<ClassicBoost_t | null> => {
    // Check if the boost already exists
    const existingBoost = await getClassicBoost(context, chainId, boostAddress);
    if (existingBoost) {
        return existingBoost;
    }

    context.log.info('Initializing ClassicBoost', { boostAddress, chainId });

    // Fetch underlying tokens using effect
    const { shareTokenAddress, underlyingTokenAddress, blacklistStatus } = await context.effect(getClassicBoostTokens, {
        boostAddress,
        chainId,
    });

    if (blacklistStatus !== 'ok') {
        logBlacklistStatus(context.log, blacklistStatus, 'ClassicBoost', {
            contractAddress: boostAddress,
            shareTokenAddress,
            underlyingTokenAddress,
        });
        return null;
    }

    // Create tokens - share token is virtual for boost
    const [shareToken, underlyingToken] = await Promise.all([
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: shareTokenAddress,
            virtual: {
                suffix: 'Boost',
                stakingToken: underlyingTokenAddress,
            },
        }),
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: underlyingTokenAddress,
            virtual: false,
        }),
    ]);

    // Create boost entity
    return await createClassicBoost({
        context,
        chainId,
        boostAddress,
        shareToken,
        underlyingToken,
        initializedBlock,
    });
};
