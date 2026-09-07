import type { EvmBlock, EvmChainId, EvmOnEventContext, RewardPool } from 'envio';
import { indexer } from 'envio';
import { fetchClassicState, parseFetchedClassicState } from '../effects/classic.effects';
import { fetchClmState, parseFetchedClmState } from '../effects/clm.effects';
import { getRewardPoolTokens } from '../effects/rewardPool.effects';
import { addClassicRewardToken, getClassic } from '../entities/classic.entity';
import { addClmRewardToken, getClm } from '../entities/clm.entity';
import { createRewardPool, getRewardPool } from '../entities/rewardPool.entity';
import { createRewardPoolRewardedEvent } from '../entities/rewardPoolRewarded.event';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { isClassicVaultStakedToken } from '../lib/classic/init';
import { handleClassicRewardPoolRewardPaid, handleClassicRewardPoolTransfer } from '../lib/classic/position';
import { buildClassicFetchInput, loadClassicTokens } from '../lib/classic/tokens';
import { isClmManagerRewardPool } from '../lib/clm/init';
import { handleClmRewardPoolRewardPaid, handleClmRewardPoolTransfer } from '../lib/clm/position';
import { buildClmFetchInput, loadClmTokens } from '../lib/clm/tokens';
import { interpretAsDecimal } from '../lib/decimal';
import { type Bytes, toBytes, toHex } from '../lib/hex';
import { maybeLinkRewardPoolProducts } from '../lib/rewardPool/link';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'RewardPool', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('RewardPool.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const rewardPoolAddress = toBytes(event.srcAddress);
    const initializedBlock = event.block;

    const rewardPool = await initializeRewardPool({ context, chainId, rewardPoolAddress, initializedBlock });
    if (!rewardPool) return;

    await maybeLinkRewardPoolProducts({ context, chainId, rewardPool });

    context.log.info('RewardPool initialized successfully', { rewardPoolAddress });
});

indexer.onEvent(
    {
        contract: 'RewardPool',
        event: 'Transfer',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('RewardPool.Transfer', { event });

        const chainId = toChainId(context.chain.id);
        const rewardPoolAddress = toBytes(event.srcAddress);

        // Ensure that the reward pool is initialized first
        let rewardPool = await initializeRewardPool({
            context,
            chainId,
            rewardPoolAddress,
            initializedBlock: event.block,
        });
        if (!rewardPool) return;

        rewardPool = await maybeLinkRewardPoolProducts({ context, chainId, rewardPool });

        const shareToken = await getTokenOrThrow({ context, id: rewardPool.shareToken_id });

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

        await maybeHandleClmRewardPoolTransfer({
            context,
            chainId,
            rewardPool,
            fromAddress: toBytes(event.params.from),
            toAddress: toBytes(event.params.to),
            rawTransferAmount: event.params.value,
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });

        await maybeHandleClassicRewardPoolTransfer({
            context,
            chainId,
            rewardPool,
            fromAddress: toBytes(event.params.from),
            toAddress: toBytes(event.params.to),
            rawTransferAmount: event.params.value,
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
        contract: 'RewardPool',
        event: 'NotifyReward',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('RewardPool.NotifyReward', { event });

        const chainId = toChainId(context.chain.id);
        const rewardPoolAddress = toBytes(event.srcAddress);

        const rewardPool = await initializeRewardPool({
            context,
            chainId,
            rewardPoolAddress,
            initializedBlock: event.block,
        });
        if (!rewardPool) return;

        const shareToken = await getTokenOrThrow({ context, id: rewardPool.shareToken_id });
        const rewardToken = await getOrCreateToken({
            context,
            chainId,
            tokenAddress: toBytes(event.params.reward),
            virtual: false,
        });
        if (!rewardToken) return;

        await createRewardPoolRewardedEvent({
            context,
            chainId,
            poolShareToken: shareToken,
            rewardToken: rewardToken,
            rewardVestingSeconds: event.params.duration,
            rewardAmount: interpretAsDecimal(event.params.amount, rewardToken.decimals),
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
        contract: 'RewardPool',
        event: 'RewardPaid',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('RewardPool.RewardPaid', { event });

        const chainId = toChainId(context.chain.id);
        const rewardPoolAddress = toBytes(event.srcAddress);

        const rewardPool = await initializeRewardPool({
            context,
            chainId,
            rewardPoolAddress,
            initializedBlock: event.block,
        });
        if (!rewardPool) return;

        const underlyingToken = await getTokenOrThrow({ context, id: rewardPool.underlyingToken_id });
        const isClmPool = await isClmManagerRewardPool({
            context,
            chainId,
            stakedTokenAddress: underlyingToken.address,
        });

        if (isClmPool) {
            const clm = await getClm(context, chainId, underlyingToken.address);
            if (!clm || clm.initializableStatus !== 'INITIALIZED') return;

            const rewardToken = await getOrCreateToken({
                context,
                chainId,
                tokenAddress: toBytes(event.params.reward),
                virtual: false,
            });
            if (!rewardToken) return;

            const tokenContext = await loadClmTokens({ context, clm });
            const rawState = await context.effect(
                fetchClmState,
                buildClmFetchInput({ clm, tokens: tokenContext, chainId, blockNumber: event.block.number })
            );
            const state = parseFetchedClmState(rawState, tokenContext);

            await handleClmRewardPoolRewardPaid({
                context,
                chainId,
                clm,
                rewardPool,
                userAddress: toBytes(event.params.user),
                rewardToken,
                rewardAmount: interpretAsDecimal(event.params.amount, rewardToken.decimals),
                state,
                event: {
                    block: event.block,
                    trxIndex: event.transaction.transactionIndex,
                    logIndex: event.logIndex,
                    trxHash: toBytes(event.transaction.hash),
                },
            });
            return;
        }

        const isClassicPool = await isClassicVaultStakedToken({
            context,
            chainId,
            stakedTokenAddress: underlyingToken.address,
        });
        if (!isClassicPool) return;

        const classic = await getClassic(context, chainId, underlyingToken.address);
        if (!classic || classic.initializableStatus !== 'INITIALIZED') return;

        const rewardToken = await getOrCreateToken({
            context,
            chainId,
            tokenAddress: toBytes(event.params.reward),
            virtual: false,
        });
        if (!rewardToken) return;

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

        await handleClassicRewardPoolRewardPaid({
            context,
            chainId,
            classic,
            accountAddress: toBytes(event.params.user),
            rewardTokenAddress: rewardToken.address,
            amount: interpretAsDecimal(event.params.amount, rewardToken.decimals),
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
        contract: 'RewardPool',
        event: 'AddReward',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('RewardPool.AddReward', { event });

        const chainId = toChainId(context.chain.id);
        const rewardPoolAddress = toBytes(event.srcAddress);
        const rewardPool = await initializeRewardPool({
            context,
            chainId,
            rewardPoolAddress,
            initializedBlock: event.block,
        });
        if (!rewardPool) return;

        const underlyingToken = await getTokenOrThrow({ context, id: rewardPool.underlyingToken_id });
        const isClmPool = await isClmManagerRewardPool({
            context,
            chainId,
            stakedTokenAddress: underlyingToken.address,
        });

        if (isClmPool) {
            const clm = await getClm(context, chainId, underlyingToken.address);
            if (!clm) return;

            const rewardToken = await getOrCreateToken({
                context,
                chainId,
                tokenAddress: toBytes(event.params.reward),
                virtual: false,
            });
            if (!rewardToken) return;

            await addClmRewardToken({ context, clm, rewardToken });
            return;
        }

        const isClassicPool = await isClassicVaultStakedToken({
            context,
            chainId,
            stakedTokenAddress: underlyingToken.address,
        });
        if (!isClassicPool) return;

        const classic = await getClassic(context, chainId, underlyingToken.address);
        if (!classic) return;

        const rewardToken = await getOrCreateToken({
            context,
            chainId,
            tokenAddress: toBytes(event.params.reward),
            virtual: false,
        });
        if (!rewardToken) return;

        await addClassicRewardToken({ context, classic, rewardToken });
    }
);

const maybeHandleClmRewardPoolTransfer = async ({
    context,
    chainId,
    rewardPool,
    fromAddress,
    toAddress,
    rawTransferAmount,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    rewardPool: RewardPool;
    fromAddress: Bytes;
    toAddress: Bytes;
    rawTransferAmount: bigint;
    event: {
        block: EvmBlock;
        trxIndex: number;
        logIndex: number;
        trxHash: Bytes;
    };
}) => {
    const underlyingToken = await getTokenOrThrow({ context, id: rewardPool.underlyingToken_id });
    const isClmPool = await isClmManagerRewardPool({
        context,
        chainId,
        stakedTokenAddress: underlyingToken.address,
    });
    if (!isClmPool) return;

    const clm = await getClm(context, chainId, underlyingToken.address);
    if (!clm || clm.initializableStatus !== 'INITIALIZED' || !clm.clmStrategy_id) return;

    const tokenContext = await loadClmTokens({ context, clm });
    const rawState = await context.effect(
        fetchClmState,
        buildClmFetchInput({ clm, tokens: tokenContext, chainId, blockNumber: event.block.number })
    );
    const state = parseFetchedClmState(rawState, tokenContext);
    const shareToken = await getTokenOrThrow({ context, id: rewardPool.shareToken_id });

    await handleClmRewardPoolTransfer({
        context,
        chainId,
        clm,
        rewardPool,
        fromAddress,
        toAddress,
        transferAmount: interpretAsDecimal(rawTransferAmount, shareToken.decimals),
        state,
        event,
    });
};

const maybeHandleClassicRewardPoolTransfer = async ({
    context,
    chainId,
    rewardPool,
    fromAddress,
    toAddress,
    rawTransferAmount,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    rewardPool: RewardPool;
    fromAddress: Bytes;
    toAddress: Bytes;
    rawTransferAmount: bigint;
    event: {
        block: EvmBlock;
        trxIndex: number;
        logIndex: number;
        trxHash: Bytes;
    };
}) => {
    if (!rewardPool.classic_id) return;

    const classic = await context.Classic.get(rewardPool.classic_id);
    if (!classic || classic.initializableStatus !== 'INITIALIZED' || !classic.classicVaultStrategy_id) return;

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
    const shareToken = await getTokenOrThrow({ context, id: rewardPool.shareToken_id });

    await handleClassicRewardPoolTransfer({
        context,
        chainId,
        classic,
        rewardPool,
        fromAddress,
        toAddress,
        transferAmount: interpretAsDecimal(rawTransferAmount, shareToken.decimals),
        state,
        event,
    });
};

const initializeRewardPool = async ({
    context,
    chainId,
    rewardPoolAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    rewardPoolAddress: Bytes;
    initializedBlock: EvmBlock;
}): Promise<RewardPool | null> => {
    // Check if the reward pool already exists
    const existingRewardPool = await getRewardPool(context, chainId, rewardPoolAddress);
    if (existingRewardPool) {
        return existingRewardPool;
    }

    context.log.info('Initializing ClassicRewardPool', { rewardPoolAddress, chainId });

    // Fetch underlying tokens using effect
    const {
        shareTokenAddress: shareTokenAddressStr,
        underlyingTokenAddress: underlyingTokenAddressStr,
        blacklistStatus,
    } = await context.effect(getRewardPoolTokens, {
        rewardPoolAddress: toHex(rewardPoolAddress),
        chainId,
    });
    const shareTokenAddress = toBytes(shareTokenAddressStr);
    const underlyingTokenAddress = toBytes(underlyingTokenAddressStr);

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

    if (!shareToken || !underlyingToken) {
        logBlacklistStatus(context.log, 'maybe_blacklisted', 'RewardPool', {
            contractAddress: rewardPoolAddress,
            shareTokenAddress,
            underlyingTokenAddress,
            reason: 'invalid_token_metadata',
        });
        return null;
    }

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
