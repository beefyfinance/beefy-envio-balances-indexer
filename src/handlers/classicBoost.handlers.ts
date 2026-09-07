import type { ClassicBoost, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import { indexer } from 'envio';
import { fetchClassicState, parseFetchedClassicState } from '../effects/classic.effects';
import { getClassicBoostTokens } from '../effects/classicBoost.effects';
import { getClassic } from '../entities/classic.entity';
import { createClassicBoost, getClassicBoost } from '../entities/classicBoost.entity';
import { createRewardPoolRewardedEvent } from '../entities/rewardPoolRewarded.event';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { isClassicVaultStakedToken, linkClassicBoost, tryLinkClassicBoost } from '../lib/classic/init';
import {
    handleClassicBoostRewardPaid,
    handleClassicBoostStake,
    handleClassicBoostUnstake,
} from '../lib/classic/position';
import { buildClassicFetchInput, loadClassicTokens } from '../lib/classic/tokens';
import { config } from '../lib/config';
import { interpretAsDecimal } from '../lib/decimal';
import { type Bytes, toBytes, toHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'ClassicBoost', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('ClassicBoost.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const boostAddress = toBytes(event.srcAddress);
    const initializedBlock = event.block;

    const boost = await initializeBoost({ context, chainId, boostAddress, initializedBlock });
    if (!boost) return;

    const stakedToken = await getTokenOrThrow({ context, id: boost.underlyingToken_id });
    const isClassicBoost = await isClassicVaultStakedToken({
        context,
        chainId,
        stakedTokenAddress: stakedToken.address,
    });
    if (!isClassicBoost) return;

    const classic = await getClassic(context, chainId, stakedToken.address);
    if (!classic) return;

    const rewardToken = await getTokenOrThrow({ context, id: boost.rewardToken_id });
    await linkClassicBoost({ context, classic, boost, rewardToken });

    context.log.info('ClassicBoost initialized successfully', { boostAddress });
});

indexer.onEvent(
    {
        contract: 'ClassicBoost',
        event: 'Staked',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('ClassicBoost.Staked', { event });

        const chainId = toChainId(context.chain.id);
        const boostAddress = toBytes(event.srcAddress);
        const initializedBlock = event.block;

        // Ensure that the boost virtual token is created first
        // otherwise, handleTokenTransfer will try and create it and fail because
        // it's not aware it is being virtual
        let boost = await initializeBoost({ context, chainId, boostAddress, initializedBlock });
        if (!boost) return;
        boost = await tryLinkClassicBoost({ context, chainId, boost });

        const shareToken = await getTokenOrThrow({ context, id: boost.shareToken_id });

        await handleTokenTransfer({
            context,
            chainId,
            token: shareToken,
            senderAddress: config.MINT_ADDRESS,
            receiverAddress: toBytes(event.params.user),
            rawTransferAmount: event.params.amount,
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });

        await maybeHandleClassicBoostStake({
            context,
            chainId,
            boost,
            accountAddress: toBytes(event.params.user),
            rawAmount: event.params.amount,
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
        contract: 'ClassicBoost',
        event: 'Withdrawn',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('ClassicBoost.Withdrawn', { event });

        const chainId = toChainId(context.chain.id);
        const boostAddress = toBytes(event.srcAddress);

        let boost = await initializeBoost({
            context,
            chainId,
            boostAddress,
            initializedBlock: event.block,
        });
        if (!boost) return;
        boost = await tryLinkClassicBoost({ context, chainId, boost });

        const shareToken = await getTokenOrThrow({ context, id: boost.shareToken_id });

        await handleTokenTransfer({
            context,
            chainId,
            token: shareToken,
            senderAddress: toBytes(event.params.user),
            receiverAddress: config.BURN_ADDRESS,
            rawTransferAmount: event.params.amount,
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });

        await maybeHandleClassicBoostUnstake({
            context,
            chainId,
            boost,
            accountAddress: toBytes(event.params.user),
            rawAmount: event.params.amount,
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
        contract: 'ClassicBoost',
        event: 'RewardAdded',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('ClassicBoost.RewardAdded', { event });

        const chainId = toChainId(context.chain.id);
        const boostAddress = toBytes(event.srcAddress);

        const boost = await initializeBoost({
            context,
            chainId,
            boostAddress,
            initializedBlock: event.block,
        });
        if (!boost) return;

        const [shareToken, rewardToken] = await Promise.all([
            getTokenOrThrow({ context, id: boost.shareToken_id }),
            getTokenOrThrow({ context, id: boost.rewardToken_id }),
        ]);

        await createRewardPoolRewardedEvent({
            context,
            chainId,
            poolShareToken: shareToken,
            rewardToken: rewardToken,
            rewardVestingSeconds: 0n,
            rewardAmount: interpretAsDecimal(event.params.reward, rewardToken.decimals),
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
        contract: 'ClassicBoost',
        event: 'RewardPaid',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('ClassicBoost.RewardPaid', { event });

        const chainId = toChainId(context.chain.id);
        const boostAddress = toBytes(event.srcAddress);

        let boost = await initializeBoost({
            context,
            chainId,
            boostAddress,
            initializedBlock: event.block,
        });
        if (!boost) return;
        boost = await tryLinkClassicBoost({ context, chainId, boost });
        if (!boost.classic_id) return;

        const classic = await context.Classic.get(boost.classic_id);
        if (!classic || classic.initializableStatus !== 'INITIALIZED') return;

        const rewardToken = await getTokenOrThrow({ context, id: boost.rewardToken_id });
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

        await handleClassicBoostRewardPaid({
            context,
            chainId,
            classic,
            accountAddress: toBytes(event.params.user),
            rewardTokenAddress: rewardToken.address,
            amount: interpretAsDecimal(event.params.reward, rewardToken.decimals),
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

const maybeHandleClassicBoostStake = async ({
    context,
    chainId,
    boost,
    accountAddress,
    rawAmount,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    boost: ClassicBoost;
    accountAddress: Bytes;
    rawAmount: bigint;
    event: {
        block: EvmBlock;
        trxIndex: number;
        logIndex: number;
        trxHash: Bytes;
    };
}) => {
    if (!boost.classic_id) return;

    const classic = await context.Classic.get(boost.classic_id);
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

    await handleClassicBoostStake({
        context,
        chainId,
        classic,
        accountAddress,
        amount: interpretAsDecimal(rawAmount, tokenContext.vaultToken.decimals),
        state,
        event,
    });
};

const maybeHandleClassicBoostUnstake = async ({
    context,
    chainId,
    boost,
    accountAddress,
    rawAmount,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    boost: ClassicBoost;
    accountAddress: Bytes;
    rawAmount: bigint;
    event: {
        block: EvmBlock;
        trxIndex: number;
        logIndex: number;
        trxHash: Bytes;
    };
}) => {
    if (!boost.classic_id) return;

    const classic = await context.Classic.get(boost.classic_id);
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

    await handleClassicBoostUnstake({
        context,
        chainId,
        classic,
        accountAddress,
        amount: interpretAsDecimal(rawAmount, tokenContext.vaultToken.decimals),
        state,
        event,
    });
};

const initializeBoost = async ({
    context,
    chainId,
    boostAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    boostAddress: Bytes;
    initializedBlock: EvmBlock;
}): Promise<ClassicBoost | null> => {
    const existingBoost = await getClassicBoost(context, chainId, boostAddress);
    if (existingBoost) {
        return existingBoost;
    }

    context.log.info('Initializing ClassicBoost', { boostAddress, chainId });

    const {
        shareTokenAddress: shareTokenAddressStr,
        stakedTokenAddress: stakedTokenAddressStr,
        rewardTokenAddress: rewardTokenAddressStr,
        blacklistStatus,
    } = await context.effect(getClassicBoostTokens, {
        boostAddress: toHex(boostAddress),
        chainId,
    });
    const shareTokenAddress = toBytes(shareTokenAddressStr);
    const stakedTokenAddress = toBytes(stakedTokenAddressStr);
    const rewardTokenAddress = toBytes(rewardTokenAddressStr);

    if (blacklistStatus !== 'ok') {
        logBlacklistStatus(context.log, blacklistStatus, 'ClassicBoost', {
            contractAddress: boostAddress,
            shareTokenAddress,
            stakedTokenAddress,
            rewardTokenAddress,
        });
        return null;
    }

    const [shareToken, stakedToken, rewardToken] = await Promise.all([
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: shareTokenAddress,
            virtual: {
                suffix: 'Boost',
                stakingToken: stakedTokenAddress,
            },
        }),
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: stakedTokenAddress,
            virtual: false,
        }),
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: rewardTokenAddress,
            virtual: false,
        }),
    ]);

    if (!shareToken || !stakedToken || !rewardToken) {
        logBlacklistStatus(context.log, 'maybe_blacklisted', 'ClassicBoost', {
            contractAddress: boostAddress,
            shareTokenAddress,
            stakedTokenAddress,
            rewardTokenAddress,
            reason: 'invalid_token_metadata',
        });
        return null;
    }

    return await createClassicBoost({
        context,
        chainId,
        boostAddress,
        shareToken,
        underlyingToken: stakedToken,
        rewardToken,
        initializedBlock,
    });
};
