import type {
    Account,
    Classic,
    ClassicErc4626Adapter,
    ClassicPosition,
    ClassicPositionInteraction,
    EvmChainId,
    EvmOnEventContext,
    RewardPool,
} from 'envio';
import type { Hex } from 'viem';
import type { ClassicState } from '../../effects/classic.effects';
import { getOrCreateAccount } from '../../entities/account.entity';
import { isClassicInitialized } from '../../entities/classic.entity';
import { getOrCreateClassicPosition, updateClassicPositionBalances } from '../../entities/classicPosition.entity';
import { config } from '../config';
import type { BigDecimal } from '../decimal';
import { BIG_ZERO } from '../decimal';
import { type EventMetadata, eventId } from '../event';
import { normalizeHex } from '../hex';

const isRewardPoolAddress = (classic: Classic, address: Hex): boolean =>
    classic.rewardPoolTokensOrder.includes(normalizeHex(address));

const isErc4626AdapterAddress = (classic: Classic, address: Hex): boolean =>
    classic.erc4626AdapterTokensOrder.includes(normalizeHex(address));

const shouldSkipTransferAddress = (classic: Classic, address: Hex): boolean => {
    const normalized = normalizeHex(address);
    return (
        normalized === config.MINT_ADDRESS ||
        normalized === config.BURN_ADDRESS ||
        normalized === normalizeHex(classic.address) ||
        isRewardPoolAddress(classic, normalized) ||
        isErc4626AdapterAddress(classic, normalized)
    );
};

const buildRewardPoolBalancesDelta = ({
    classic,
    rewardPoolAddress,
    amount,
}: {
    classic: Classic;
    rewardPoolAddress: Hex;
    amount: BigDecimal;
}): BigDecimal[] =>
    classic.rewardPoolTokensOrder.map((address) =>
        normalizeHex(address) === normalizeHex(rewardPoolAddress) ? amount : BIG_ZERO
    );

const buildErc4626AdapterBalancesDelta = ({
    classic,
    adapterAddress,
    amount,
}: {
    classic: Classic;
    adapterAddress: Hex;
    amount: BigDecimal;
}): BigDecimal[] =>
    classic.erc4626AdapterTokensOrder.map((address) =>
        normalizeHex(address) === normalizeHex(adapterAddress) ? amount : BIG_ZERO
    );

const applyBalanceDeltas = ({
    position,
    vaultBalanceDelta,
    boostBalanceDelta,
    rewardPoolBalancesDelta,
    erc4626AdapterBalancesDelta,
    state,
}: {
    position: ClassicPosition;
    vaultBalanceDelta: BigDecimal;
    boostBalanceDelta: BigDecimal;
    rewardPoolBalancesDelta: BigDecimal[];
    erc4626AdapterBalancesDelta: BigDecimal[];
    state: ClassicState;
}) => {
    const vaultBalance = position.vaultBalance.plus(vaultBalanceDelta);
    const boostBalance = position.boostBalance.plus(boostBalanceDelta);

    const rewardPoolBalances = rewardPoolBalancesDelta.map((delta, index) => {
        const previous = position.rewardPoolBalances[index] ?? BIG_ZERO;
        return previous.plus(delta);
    });

    const erc4626AdapterBalances = erc4626AdapterBalancesDelta.map((delta, index) => {
        const previous = position.erc4626AdapterBalances[index] ?? BIG_ZERO;
        return previous.plus(delta);
    });

    const erc4626AdapterVaultSharesBalances = erc4626AdapterBalances.map((adapterBalance, index) => {
        const adapterTotalSupply = state.erc4626AdaptersTotalSupply[index] ?? BIG_ZERO;
        if (adapterTotalSupply.eq(BIG_ZERO)) {
            return BIG_ZERO;
        }
        const vaultSharesTotal = state.erc4626AdapterVaultSharesBalances[index] ?? BIG_ZERO;
        return adapterBalance.times(vaultSharesTotal).dividedBy(adapterTotalSupply);
    });

    const erc4626AdapterVaultSharesBalancesDelta = erc4626AdapterVaultSharesBalances.map((balance, index) => {
        const previous = position.erc4626AdapterVaultSharesBalances[index] ?? BIG_ZERO;
        return balance.minus(previous);
    });

    return {
        vaultBalance,
        boostBalance,
        rewardPoolBalances,
        erc4626AdapterBalances,
        erc4626AdapterVaultSharesBalances,
        erc4626AdapterVaultSharesBalancesDelta,
    };
};

const createClassicPositionInteraction = async ({
    context,
    chainId,
    classic,
    account,
    position,
    interactionSuffix,
    type,
    vaultBalanceDelta,
    boostBalanceDelta,
    boostRewardBalancesDelta,
    rewardPoolBalancesDelta,
    rewardBalancesDelta,
    erc4626AdapterBalancesDelta,
    erc4626AdapterVaultSharesBalancesDelta,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    account: Account;
    position: ClassicPosition;
    interactionSuffix: number;
    type: ClassicPositionInteraction['type'];
    vaultBalanceDelta: BigDecimal;
    boostBalanceDelta: BigDecimal;
    boostRewardBalancesDelta: BigDecimal[];
    rewardPoolBalancesDelta: BigDecimal[];
    rewardBalancesDelta: BigDecimal[];
    erc4626AdapterBalancesDelta: BigDecimal[];
    erc4626AdapterVaultSharesBalancesDelta: BigDecimal[];
    state: ClassicState;
    event: EventMetadata;
}) => {
    const id = `${eventId({ chainId, trxHash: event.trxHash, trxIndex: event.trxIndex, logIndex: event.logIndex })}-${interactionSuffix.toString()}`;

    const interaction: ClassicPositionInteraction = {
        id,
        classic_id: classic.id,
        account_id: account.id,
        classicPosition_id: position.id,
        trxHash: event.trxHash,
        trxIndex: event.trxIndex,
        logIndex: event.logIndex,
        blockNumber: BigInt(event.block.number),
        blockTimestamp: new Date(event.block.timestamp * 1000),
        type,
        vaultBalance: position.vaultBalance,
        boostBalance: position.boostBalance,
        rewardPoolBalances: position.rewardPoolBalances,
        erc4626AdapterBalances: position.erc4626AdapterBalances,
        erc4626AdapterVaultSharesBalances: position.erc4626AdapterVaultSharesBalances,
        totalBalance: position.totalBalance,
        vaultTokenTotalSupply: state.vaultTokenTotalSupply,
        vaultUnderlyingTotalSupply: state.vaultUnderlyingTotalSupply,
        vaultUnderlyingBreakdownBalances: state.vaultUnderlyingBreakdownBalances,
        vaultUnderlyingAmount: state.underlyingAmount,
        vaultUnderlyingBalance: state.underlyingAmount,
        vaultBalanceDelta,
        boostBalanceDelta,
        boostRewardBalancesDelta,
        rewardPoolBalancesDelta,
        rewardBalancesDelta,
        erc4626AdapterBalancesDelta,
        erc4626AdapterVaultSharesBalancesDelta,
        underlyingToNativePrice: state.underlyingToNativePrice,
        underlyingBreakdownToNativePrices: state.underlyingBreakdownToNativePrices,
        boostRewardToNativePrices: state.boostRewardToNativePrices,
        rewardToNativePrices: state.rewardToNativePrices,
        nativeToUSDPrice: state.nativeToUSDPrice,
    };

    context.ClassicPositionInteraction.set(interaction);
};

const updateClassicPositionFromDeltas = async ({
    context,
    chainId,
    classic,
    accountAddress,
    vaultBalanceDelta,
    boostBalanceDelta,
    boostRewardBalancesDelta,
    rewardPoolBalancesDelta,
    rewardBalancesDelta,
    erc4626AdapterBalancesDelta,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    accountAddress: Hex;
    vaultBalanceDelta: BigDecimal;
    boostBalanceDelta: BigDecimal;
    boostRewardBalancesDelta: BigDecimal[];
    rewardPoolBalancesDelta: BigDecimal[];
    rewardBalancesDelta: BigDecimal[];
    erc4626AdapterBalancesDelta: BigDecimal[];
    state: ClassicState;
    event: EventMetadata;
}) => {
    if (!isClassicInitialized(classic)) {
        context.log.warn('Classic is not initialized, ignoring position update', { classicId: classic.id });
        return;
    }

    const account = await getOrCreateAccount({ context, chainId, accountAddress });
    if (!account) {
        return;
    }

    let position = await getOrCreateClassicPosition({
        context,
        classic,
        account,
        createdWithTrxHash: event.trxHash,
    });

    const balances = applyBalanceDeltas({
        position,
        vaultBalanceDelta,
        boostBalanceDelta,
        rewardPoolBalancesDelta,
        erc4626AdapterBalancesDelta,
        state,
    });

    await updateClassicPositionBalances({
        context,
        position,
        vaultBalance: balances.vaultBalance,
        boostBalance: balances.boostBalance,
        rewardPoolBalances: balances.rewardPoolBalances,
        erc4626AdapterBalances: balances.erc4626AdapterBalances,
        erc4626AdapterVaultSharesBalances: balances.erc4626AdapterVaultSharesBalances,
    });

    position = (await context.ClassicPosition.get(position.id)) as ClassicPosition;

    const isSharesTransfer = !vaultBalanceDelta.eq(BIG_ZERO);
    const isBoostTransfer = !boostBalanceDelta.eq(BIG_ZERO);
    const isBoostRewardTransfer = boostRewardBalancesDelta.some((delta) => !delta.eq(BIG_ZERO));
    const isRewardPoolTransfer = rewardPoolBalancesDelta.some((delta) => !delta.eq(BIG_ZERO));
    const isRewardClaim = rewardBalancesDelta.some((delta) => !delta.eq(BIG_ZERO));
    const isErc4626AdapterTransfer = erc4626AdapterBalancesDelta.some((delta) => !delta.eq(BIG_ZERO));

    let interactionSuffix = 0;
    if (isSharesTransfer) interactionSuffix = 0;
    else if (isBoostTransfer) interactionSuffix = 1;
    else if (isBoostRewardTransfer) interactionSuffix = 2;
    else if (isRewardPoolTransfer) interactionSuffix = 3;
    else if (isRewardClaim) interactionSuffix = 4;
    else if (isErc4626AdapterTransfer) interactionSuffix = 5;

    let type: ClassicPositionInteraction['type'] = 'VAULT_DEPOSIT';
    if (isSharesTransfer) {
        type = vaultBalanceDelta.gt(BIG_ZERO) ? 'VAULT_DEPOSIT' : 'VAULT_WITHDRAW';
    } else if (isBoostTransfer) {
        type = boostBalanceDelta.gt(BIG_ZERO) ? 'BOOST_STAKE' : 'BOOST_UNSTAKE';
    } else if (isBoostRewardTransfer) {
        type = 'BOOST_REWARD_CLAIM';
    } else if (isRewardPoolTransfer) {
        type = rewardPoolBalancesDelta.some((delta) => delta.gt(BIG_ZERO))
            ? 'CLASSIC_REWARD_POOL_STAKE'
            : 'CLASSIC_REWARD_POOL_UNSTAKE';
    } else if (isRewardClaim) {
        type = 'CLASSIC_REWARD_POOL_CLAIM';
    } else if (isErc4626AdapterTransfer) {
        type = erc4626AdapterBalancesDelta.some((delta) => delta.gt(BIG_ZERO))
            ? 'CLASSIC_ERC4626_ADAPTER_STAKE'
            : 'CLASSIC_ERC4626_ADAPTER_UNSTAKE';
    }

    await createClassicPositionInteraction({
        context,
        chainId,
        classic,
        account,
        position,
        interactionSuffix,
        type,
        vaultBalanceDelta,
        boostBalanceDelta,
        boostRewardBalancesDelta,
        rewardPoolBalancesDelta,
        rewardBalancesDelta,
        erc4626AdapterBalancesDelta,
        erc4626AdapterVaultSharesBalancesDelta: balances.erc4626AdapterVaultSharesBalancesDelta,
        state,
        event,
    });
};

export const handleClassicVaultTransfer = async ({
    context,
    chainId,
    classic,
    fromAddress,
    toAddress,
    transferAmount,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    fromAddress: Hex;
    toAddress: Hex;
    transferAmount: BigDecimal;
    state: ClassicState;
    event: EventMetadata;
}) => {
    if (normalizeHex(fromAddress) === normalizeHex(toAddress) || transferAmount.eq(BIG_ZERO)) {
        return;
    }

    if (!shouldSkipTransferAddress(classic, fromAddress)) {
        await updateClassicPositionFromDeltas({
            context,
            chainId,
            classic,
            accountAddress: fromAddress,
            vaultBalanceDelta: transferAmount.negated(),
            boostBalanceDelta: BIG_ZERO,
            boostRewardBalancesDelta: [],
            rewardPoolBalancesDelta: [],
            rewardBalancesDelta: [],
            erc4626AdapterBalancesDelta: [],
            state,
            event,
        });
    }

    if (!shouldSkipTransferAddress(classic, toAddress)) {
        await updateClassicPositionFromDeltas({
            context,
            chainId,
            classic,
            accountAddress: toAddress,
            vaultBalanceDelta: transferAmount,
            boostBalanceDelta: BIG_ZERO,
            boostRewardBalancesDelta: [],
            rewardPoolBalancesDelta: [],
            rewardBalancesDelta: [],
            erc4626AdapterBalancesDelta: [],
            state,
            event,
        });
    }
};

export const handleClassicBoostStake = async ({
    context,
    chainId,
    classic,
    accountAddress,
    amount,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    accountAddress: Hex;
    amount: BigDecimal;
    state: ClassicState;
    event: EventMetadata;
}) => {
    await updateClassicPositionFromDeltas({
        context,
        chainId,
        classic,
        accountAddress,
        vaultBalanceDelta: BIG_ZERO,
        boostBalanceDelta: amount,
        boostRewardBalancesDelta: [],
        rewardPoolBalancesDelta: [],
        rewardBalancesDelta: [],
        erc4626AdapterBalancesDelta: [],
        state,
        event,
    });
};

export const handleClassicBoostUnstake = async ({
    context,
    chainId,
    classic,
    accountAddress,
    amount,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    accountAddress: Hex;
    amount: BigDecimal;
    state: ClassicState;
    event: EventMetadata;
}) => {
    await updateClassicPositionFromDeltas({
        context,
        chainId,
        classic,
        accountAddress,
        vaultBalanceDelta: BIG_ZERO,
        boostBalanceDelta: amount.negated(),
        boostRewardBalancesDelta: [],
        rewardPoolBalancesDelta: [],
        rewardBalancesDelta: [],
        erc4626AdapterBalancesDelta: [],
        state,
        event,
    });
};

export const handleClassicBoostRewardPaid = async ({
    context,
    chainId,
    classic,
    accountAddress,
    rewardTokenAddress,
    amount,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    accountAddress: Hex;
    rewardTokenAddress: Hex;
    amount: BigDecimal;
    state: ClassicState;
    event: EventMetadata;
}) => {
    const boostRewardBalancesDelta = classic.boostRewardTokensOrder.map((address) =>
        normalizeHex(address) === normalizeHex(rewardTokenAddress) ? amount : BIG_ZERO
    );

    await updateClassicPositionFromDeltas({
        context,
        chainId,
        classic,
        accountAddress,
        vaultBalanceDelta: BIG_ZERO,
        boostBalanceDelta: BIG_ZERO,
        boostRewardBalancesDelta,
        rewardPoolBalancesDelta: [],
        rewardBalancesDelta: [],
        erc4626AdapterBalancesDelta: [],
        state,
        event,
    });
};

export const handleClassicRewardPoolTransfer = async ({
    context,
    chainId,
    classic,
    rewardPool,
    fromAddress,
    toAddress,
    transferAmount,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    rewardPool: RewardPool;
    fromAddress: Hex;
    toAddress: Hex;
    transferAmount: BigDecimal;
    state: ClassicState;
    event: EventMetadata;
}) => {
    if (normalizeHex(fromAddress) === normalizeHex(toAddress) || transferAmount.eq(BIG_ZERO)) {
        return;
    }

    const rewardPoolBalancesDelta = buildRewardPoolBalancesDelta({
        classic,
        rewardPoolAddress: normalizeHex(rewardPool.address),
        amount: transferAmount,
    });

    if (!shouldSkipTransferAddress(classic, toAddress)) {
        await updateClassicPositionFromDeltas({
            context,
            chainId,
            classic,
            accountAddress: toAddress,
            vaultBalanceDelta: BIG_ZERO,
            boostBalanceDelta: BIG_ZERO,
            boostRewardBalancesDelta: [],
            rewardPoolBalancesDelta,
            rewardBalancesDelta: [],
            erc4626AdapterBalancesDelta: [],
            state,
            event,
        });
    }

    if (!shouldSkipTransferAddress(classic, fromAddress)) {
        await updateClassicPositionFromDeltas({
            context,
            chainId,
            classic,
            accountAddress: fromAddress,
            vaultBalanceDelta: BIG_ZERO,
            boostBalanceDelta: BIG_ZERO,
            boostRewardBalancesDelta: [],
            rewardPoolBalancesDelta: rewardPoolBalancesDelta.map((delta) => delta.negated()),
            rewardBalancesDelta: [],
            erc4626AdapterBalancesDelta: [],
            state,
            event,
        });
    }
};

export const handleClassicRewardPoolRewardPaid = async ({
    context,
    chainId,
    classic,
    accountAddress,
    rewardTokenAddress,
    amount,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    accountAddress: Hex;
    rewardTokenAddress: Hex;
    amount: BigDecimal;
    state: ClassicState;
    event: EventMetadata;
}) => {
    const rewardBalancesDelta = classic.rewardTokensOrder.map((address) =>
        normalizeHex(address) === normalizeHex(rewardTokenAddress) ? amount : BIG_ZERO
    );

    await updateClassicPositionFromDeltas({
        context,
        chainId,
        classic,
        accountAddress,
        vaultBalanceDelta: BIG_ZERO,
        boostBalanceDelta: BIG_ZERO,
        boostRewardBalancesDelta: [],
        rewardPoolBalancesDelta: [],
        rewardBalancesDelta,
        erc4626AdapterBalancesDelta: [],
        state,
        event,
    });
};

export const handleClassicErc4626AdapterTransfer = async ({
    context,
    chainId,
    classic,
    adapter,
    fromAddress,
    toAddress,
    transferAmount,
    state,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    adapter: ClassicErc4626Adapter;
    fromAddress: Hex;
    toAddress: Hex;
    transferAmount: BigDecimal;
    state: ClassicState;
    event: EventMetadata;
}) => {
    if (normalizeHex(fromAddress) === normalizeHex(toAddress) || transferAmount.eq(BIG_ZERO)) {
        return;
    }

    const erc4626AdapterBalancesDelta = buildErc4626AdapterBalancesDelta({
        classic,
        adapterAddress: normalizeHex(adapter.address),
        amount: transferAmount,
    });

    if (!shouldSkipTransferAddress(classic, toAddress)) {
        await updateClassicPositionFromDeltas({
            context,
            chainId,
            classic,
            accountAddress: toAddress,
            vaultBalanceDelta: BIG_ZERO,
            boostBalanceDelta: BIG_ZERO,
            boostRewardBalancesDelta: [],
            rewardPoolBalancesDelta: [],
            rewardBalancesDelta: [],
            erc4626AdapterBalancesDelta,
            state,
            event,
        });
    }

    if (!shouldSkipTransferAddress(classic, fromAddress)) {
        await updateClassicPositionFromDeltas({
            context,
            chainId,
            classic,
            accountAddress: fromAddress,
            vaultBalanceDelta: BIG_ZERO,
            boostBalanceDelta: BIG_ZERO,
            boostRewardBalancesDelta: [],
            rewardPoolBalancesDelta: [],
            rewardBalancesDelta: [],
            erc4626AdapterBalancesDelta: erc4626AdapterBalancesDelta.map((delta) => delta.negated()),
            state,
            event,
        });
    }
};
