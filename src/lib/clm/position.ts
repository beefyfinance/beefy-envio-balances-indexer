import type {
    Account,
    Clm,
    ClmPosition,
    ClmPositionInteraction,
    EvmChainId,
    EvmOnEventContext,
    RewardPool,
    Token,
} from 'envio';
import type { Hex } from 'viem';
import type { ClmState } from '../../effects/clm.effects';
import { getOrCreateAccount } from '../../entities/account.entity';
import { isClmInitialized } from '../../entities/clm.entity';
import { getOrCreateClmPosition, updateClmPositionBalances } from '../../entities/clmPosition.entity';
import { config } from '../config';
import type { BigDecimal } from '../decimal';
import { BIG_ZERO } from '../decimal';
import { type EventMetadata, eventId } from '../event';
import { normalizeHex } from '../hex';

const isRewardPoolAddress = (clm: Clm, address: Hex): boolean => {
    const normalized = normalizeHex(address);
    return clm.rewardPoolTokensOrder.includes(normalized);
};

const shouldSkipTransferAddress = (clm: Clm, address: Hex): boolean => {
    const normalized = normalizeHex(address);
    return (
        normalized === config.MINT_ADDRESS ||
        normalized === config.BURN_ADDRESS ||
        normalized === normalizeHex(clm.address) ||
        isRewardPoolAddress(clm, normalized)
    );
};

const buildRewardPoolBalancesDelta = ({
    clm,
    rewardPoolAddress,
    amount,
}: {
    clm: Clm;
    rewardPoolAddress: Hex;
    amount: BigDecimal;
}): BigDecimal[] =>
    clm.rewardPoolTokensOrder.map((address) =>
        normalizeHex(address) === normalizeHex(rewardPoolAddress) ? amount : BIG_ZERO
    );

const applyBalanceDeltas = ({
    position,
    managerBalanceDelta,
    rewardPoolBalancesDelta,
}: {
    position: ClmPosition;
    managerBalanceDelta: BigDecimal;
    rewardPoolBalancesDelta: BigDecimal[];
}) => {
    const managerBalance = position.managerBalance.plus(managerBalanceDelta);

    const rewardPoolBalances = rewardPoolBalancesDelta.map((delta, index) => {
        const previous = position.rewardPoolBalances[index] ?? BIG_ZERO;
        return previous.plus(delta);
    });

    let totalBalance = managerBalance;
    for (const balance of rewardPoolBalances) {
        totalBalance = totalBalance.plus(balance);
    }

    return {
        managerBalance,
        rewardPoolBalances,
        totalBalance,
    };
};

const createClmPositionInteraction = async ({
    context,
    chainId,
    clm,
    account,
    position,
    interactionSuffix,
    type,
    managerBalanceDelta,
    rewardPoolBalancesDelta,
    rewardBalancesDelta,
    state,
    totalBalance,
    event,
    claimedRewardPool_id,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    account: Account;
    position: ClmPosition;
    interactionSuffix: number;
    type: ClmPositionInteraction['type'];
    managerBalanceDelta: BigDecimal;
    rewardPoolBalancesDelta: BigDecimal[];
    rewardBalancesDelta: BigDecimal[];
    state: ClmState;
    totalBalance: BigDecimal;
    event: EventMetadata;
    claimedRewardPool_id?: string;
}) => {
    const baseId = eventId({
        chainId,
        trxHash: event.trxHash,
        trxIndex: event.trxIndex,
        logIndex: event.logIndex,
    });
    const id = `${baseId}-${interactionSuffix.toString()}`;

    let underlyingBalance0 = BIG_ZERO;
    let underlyingBalance1 = BIG_ZERO;
    let underlyingBalance0Delta = BIG_ZERO;
    let underlyingBalance1Delta = BIG_ZERO;

    if (!state.managerTotalSupply.eq(BIG_ZERO)) {
        underlyingBalance0 = state.totalUnderlyingAmount0.times(totalBalance).dividedBy(state.managerTotalSupply);
        underlyingBalance1 = state.totalUnderlyingAmount1.times(totalBalance).dividedBy(state.managerTotalSupply);

        const totalRewardPoolBalanceDelta = rewardPoolBalancesDelta.reduce((acc, delta) => acc.plus(delta), BIG_ZERO);
        const positionEquivalentInManagerBalance = managerBalanceDelta.plus(totalRewardPoolBalanceDelta);
        underlyingBalance0Delta = state.totalUnderlyingAmount0
            .times(positionEquivalentInManagerBalance)
            .dividedBy(state.managerTotalSupply);
        underlyingBalance1Delta = state.totalUnderlyingAmount1
            .times(positionEquivalentInManagerBalance)
            .dividedBy(state.managerTotalSupply);
    }

    const interaction: ClmPositionInteraction = {
        id,
        chainId,
        clm_id: clm.id,
        account_id: account.id,
        clmPosition_id: position.id,
        trxHash: event.trxHash,
        trxIndex: event.trxIndex,
        logIndex: event.logIndex,
        blockNumber: BigInt(event.block.number),
        blockTimestamp: new Date(event.block.timestamp * 1000),
        type,
        managerBalance: position.managerBalance,
        rewardPoolBalances: position.rewardPoolBalances,
        totalBalance: position.totalBalance,
        underlyingBalance0,
        underlyingBalance1,
        managerBalanceDelta,
        rewardPoolBalancesDelta,
        rewardBalancesDelta,
        claimedRewardPool_id,
        underlyingBalance0Delta,
        underlyingBalance1Delta,
        token0ToNativePrice: state.token0ToNativePrice,
        token1ToNativePrice: state.token1ToNativePrice,
        outputToNativePrices: state.outputToNativePrices,
        rewardToNativePrices: state.rewardToNativePrices,
        nativeToUSDPrice: state.nativeToUSDPrice,
    };

    context.ClmPositionInteraction.set(interaction);
};

const updateClmPositionFromDeltas = async ({
    context,
    chainId,
    clm,
    accountAddress,
    managerBalanceDelta,
    rewardPoolBalancesDelta,
    rewardBalancesDelta,
    state,
    event,
    claimedRewardPool,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    accountAddress: Hex;
    managerBalanceDelta: BigDecimal;
    rewardPoolBalancesDelta: BigDecimal[];
    rewardBalancesDelta: BigDecimal[];
    state: ClmState;
    event: EventMetadata;
    claimedRewardPool?: RewardPool;
}) => {
    if (!isClmInitialized(clm)) {
        context.log.warn('CLM is not initialized, ignoring position update', { clmId: clm.id });
        return;
    }

    const account = await getOrCreateAccount({ context, chainId, accountAddress });
    if (!account) {
        return;
    }

    let position = await getOrCreateClmPosition({ context, clm, account });

    const balances = applyBalanceDeltas({
        position,
        managerBalanceDelta,
        rewardPoolBalancesDelta,
    });

    await updateClmPositionBalances({
        context,
        position,
        managerBalance: balances.managerBalance,
        rewardPoolBalances: balances.rewardPoolBalances,
    });

    position = (await context.ClmPosition.get(position.id)) as ClmPosition;

    const isSharesTransfer = !managerBalanceDelta.eq(BIG_ZERO);
    const isRewardPoolTransfer = rewardPoolBalancesDelta.some((delta) => !delta.eq(BIG_ZERO));
    const isRewardClaim = rewardBalancesDelta.some((delta) => !delta.eq(BIG_ZERO));

    let interactionSuffix = 0;
    if (isSharesTransfer) {
        interactionSuffix = 0;
    } else if (isRewardPoolTransfer) {
        interactionSuffix = 1;
    } else if (isRewardClaim) {
        interactionSuffix = 2;
    }

    let type: ClmPositionInteraction['type'] = 'MANAGER_DEPOSIT';
    if (isSharesTransfer) {
        type = managerBalanceDelta.gt(BIG_ZERO) ? 'MANAGER_DEPOSIT' : 'MANAGER_WITHDRAW';
    } else if (isRewardPoolTransfer) {
        type = rewardPoolBalancesDelta.some((delta) => delta.gt(BIG_ZERO))
            ? 'CLM_REWARD_POOL_STAKE'
            : 'CLM_REWARD_POOL_UNSTAKE';
    } else if (isRewardClaim) {
        type = 'CLM_REWARD_POOL_CLAIM';
    }

    await createClmPositionInteraction({
        context,
        chainId,
        clm,
        account,
        position,
        interactionSuffix,
        type,
        managerBalanceDelta,
        rewardPoolBalancesDelta,
        rewardBalancesDelta,
        state,
        totalBalance: balances.totalBalance,
        event,
        claimedRewardPool_id: claimedRewardPool?.id,
    });
};

export const handleClmManagerTransfer = async ({
    context,
    chainId,
    clm,
    fromAddress,
    toAddress,
    transferAmount,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    fromAddress: Hex;
    toAddress: Hex;
    transferAmount: BigDecimal;
    state: ClmState;
    event: EventMetadata;
}) => {
    if (normalizeHex(fromAddress) === normalizeHex(toAddress) || transferAmount.eq(BIG_ZERO)) {
        return;
    }

    if (!shouldSkipTransferAddress(clm, fromAddress)) {
        await updateClmPositionFromDeltas({
            context,
            chainId,
            clm,
            accountAddress: fromAddress,
            managerBalanceDelta: transferAmount.negated(),
            rewardPoolBalancesDelta: [],
            rewardBalancesDelta: [],
            state,
            event,
        });
    }

    if (!shouldSkipTransferAddress(clm, toAddress)) {
        await updateClmPositionFromDeltas({
            context,
            chainId,
            clm,
            accountAddress: toAddress,
            managerBalanceDelta: transferAmount,
            rewardPoolBalancesDelta: [],
            rewardBalancesDelta: [],
            state,
            event,
        });
    }
};

export const handleClmRewardPoolTransfer = async ({
    context,
    chainId,
    clm,
    rewardPool,
    fromAddress,
    toAddress,
    transferAmount,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    rewardPool: RewardPool;
    fromAddress: Hex;
    toAddress: Hex;
    transferAmount: BigDecimal;
    state: ClmState;
    event: EventMetadata;
}) => {
    if (normalizeHex(fromAddress) === normalizeHex(toAddress) || transferAmount.eq(BIG_ZERO)) {
        return;
    }

    const rewardPoolBalancesDelta = buildRewardPoolBalancesDelta({
        clm,
        rewardPoolAddress: normalizeHex(rewardPool.address),
        amount: transferAmount,
    });

    if (!shouldSkipTransferAddress(clm, toAddress)) {
        await updateClmPositionFromDeltas({
            context,
            chainId,
            clm,
            accountAddress: toAddress,
            managerBalanceDelta: BIG_ZERO,
            rewardPoolBalancesDelta,
            rewardBalancesDelta: [],
            state,
            event,
        });
    }

    if (!shouldSkipTransferAddress(clm, fromAddress)) {
        await updateClmPositionFromDeltas({
            context,
            chainId,
            clm,
            accountAddress: fromAddress,
            managerBalanceDelta: BIG_ZERO,
            rewardPoolBalancesDelta: rewardPoolBalancesDelta.map((delta) => delta.negated()),
            rewardBalancesDelta: [],
            state,
            event,
        });
    }
};

export const handleClmRewardPoolRewardPaid = async ({
    context,
    chainId,
    clm,
    rewardPool,
    userAddress,
    rewardToken,
    rewardAmount,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    rewardPool: RewardPool;
    userAddress: Hex;
    rewardToken: Token;
    rewardAmount: BigDecimal;
    state: ClmState;
    event: EventMetadata;
}) => {
    const rewardBalancesDelta = clm.rewardTokensOrder.map((address) =>
        normalizeHex(address) === normalizeHex(rewardToken.address) ? rewardAmount : BIG_ZERO
    );

    await updateClmPositionFromDeltas({
        context,
        chainId,
        clm,
        accountAddress: userAddress,
        managerBalanceDelta: BIG_ZERO,
        rewardPoolBalancesDelta: [],
        rewardBalancesDelta,
        state,
        event,
        claimedRewardPool: rewardPool,
    });
};
