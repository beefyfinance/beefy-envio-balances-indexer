import type { ClassicBoost, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import { indexer } from 'envio';
import type { Hex } from 'viem';
import { getClassicBoostTokens } from '../effects/classicBoost.effects';
import { createClassicBoost, getClassicBoost } from '../entities/classicBoost.entity';
import { createPoolRewardedEvent } from '../entities/poolRewarded.event';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { config } from '../lib/config';
import { normalizeHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'ClassicBoost', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('ClassicBoost.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const boostAddress = normalizeHex(event.srcAddress);
    const initializedBlock = event.block;

    const boost = await initializeBoost({ context, chainId, boostAddress, initializedBlock });
    if (!boost) return;

    context.log.info('ClassicBoost initialized successfully', { boostAddress });
});

indexer.onEvent({ contract: 'ClassicBoost', event: 'Staked' }, async ({ event, context }) => {
    context.log.debug('ClassicBoost.Staked', { event });

    const chainId = toChainId(context.chain.id);
    const boostAddress = normalizeHex(event.srcAddress);
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
        receiverAddress: normalizeHex(event.params.user),
        rawTransferAmount: event.params.amount,
        event: {
            block: event.block,
            trxIndex: event.transaction.transactionIndex,
            logIndex: event.logIndex,
            trxHash: normalizeHex(event.transaction.hash),
        },
    });
});

indexer.onEvent({ contract: 'ClassicBoost', event: 'Withdrawn' }, async ({ event, context }) => {
    context.log.debug('ClassicBoost.Withdrawn', { event });

    const chainId = toChainId(context.chain.id);
    const boostAddress = normalizeHex(event.srcAddress);

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
        senderAddress: normalizeHex(event.params.user),
        receiverAddress: config.BURN_ADDRESS,
        rawTransferAmount: event.params.amount,
        event: {
            block: event.block,
            trxIndex: event.transaction.transactionIndex,
            logIndex: event.logIndex,
            trxHash: normalizeHex(event.transaction.hash),
        },
    });
});

indexer.onEvent({ contract: 'ClassicBoost', event: 'RewardAdded' }, async ({ event, context }) => {
    context.log.debug('ClassicBoost.RewardAdded', { event });

    const chainId = toChainId(context.chain.id);
    const boostAddress = normalizeHex(event.srcAddress);

    const boost = await initializeBoost({
        context,
        chainId,
        boostAddress,
        initializedBlock: event.block,
    });
    if (!boost) return;

    const [shareToken, rewardToken] = await Promise.all([
        getTokenOrThrow({ context, id: boost.shareToken_id }),
        getTokenOrThrow({ context, id: boost.underlyingToken_id }),
    ]);

    await createPoolRewardedEvent({
        context,
        chainId,
        poolShareToken: shareToken,
        rewardToken: rewardToken,
        rewardVestingSeconds: 0n, // boost rewards are immediate
        rawRewardAmount: event.params.reward,
        event: {
            block: event.block,
            trxIndex: event.transaction.transactionIndex,
            logIndex: event.logIndex,
            trxHash: normalizeHex(event.transaction.hash),
        },
    });
});

const initializeBoost = async ({
    context,
    chainId,
    boostAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    boostAddress: Hex;
    initializedBlock: EvmBlock;
}): Promise<ClassicBoost | null> => {
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

    if (!shareToken || !underlyingToken) {
        logBlacklistStatus(context.log, 'maybe_blacklisted', 'ClassicBoost', {
            contractAddress: boostAddress,
            shareTokenAddress,
            underlyingTokenAddress,
            reason: 'invalid_token_metadata',
        });
        return null;
    }

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
