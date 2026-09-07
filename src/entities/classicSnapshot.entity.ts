import type { Classic, ClassicSnapshot, EvmOnEventContext } from 'envio';
import type { ClassicState } from '../effects/classic.effects';
import { BIG_ZERO, type BigDecimal } from '../lib/decimal';
import {
    CLASSIC_SNAPSHOT_PERIODS,
    getClassicSnapshotIdForTimestamp,
    getPreviousClassicSnapshotIdForTimestamp,
} from '../lib/snapshot/classic';
import { classicStatsFromState } from './classic.entity';

export const getOrCreateClassicSnapshot = async ({
    context,
    classic,
    timestamp,
    period,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    timestamp: number;
    period: number;
}): Promise<ClassicSnapshot> => {
    const { id, roundedTimestamp } = getClassicSnapshotIdForTimestamp({ classicId: classic.id, timestamp, period });
    const existing = await context.ClassicSnapshot.get(id);
    if (existing) {
        return existing;
    }

    const previousSnapshotId = getPreviousClassicSnapshotIdForTimestamp({ classicId: classic.id, timestamp, period });
    const previousSnapshot = await context.ClassicSnapshot.get(previousSnapshotId);

    const snapshot: ClassicSnapshot = {
        id,
        classic_id: classic.id,
        period: BigInt(period),
        roundedTimestamp: new Date(roundedTimestamp * 1000),
        blockTimestamp: new Date(timestamp * 1000),
        vaultTokenTotalSupply: previousSnapshot?.vaultTokenTotalSupply ?? BIG_ZERO,
        underlyingAmount: previousSnapshot?.underlyingAmount ?? BIG_ZERO,
        vaultUnderlyingTotalSupply: previousSnapshot?.vaultUnderlyingTotalSupply ?? BIG_ZERO,
        vaultUnderlyingBreakdownBalances: previousSnapshot?.vaultUnderlyingBreakdownBalances ?? [],
        vaultUnderlyingBalance: previousSnapshot?.vaultUnderlyingBalance ?? BIG_ZERO,
        rewardPoolsTotalSupply: previousSnapshot?.rewardPoolsTotalSupply ?? [],
        erc4626AdaptersTotalSupply: previousSnapshot?.erc4626AdaptersTotalSupply ?? [],
        erc4626AdapterVaultSharesBalances: previousSnapshot?.erc4626AdapterVaultSharesBalances ?? [],
        underlyingToNativePrice: previousSnapshot?.underlyingToNativePrice ?? BIG_ZERO,
        underlyingBreakdownToNativePrices: previousSnapshot?.underlyingBreakdownToNativePrices ?? [],
        boostRewardToNativePrices: previousSnapshot?.boostRewardToNativePrices ?? [],
        rewardToNativePrices: previousSnapshot?.rewardToNativePrices ?? [],
        nativeToUSDPrice: previousSnapshot?.nativeToUSDPrice ?? BIG_ZERO,
        totalCallFees: BIG_ZERO,
        totalBeefyFees: BIG_ZERO,
        totalStrategistFees: BIG_ZERO,
    };

    context.ClassicSnapshot.set(snapshot);
    return snapshot;
};

export const writeClassicSnapshotFromState = async ({
    context,
    classic,
    state,
    timestamp,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    state: ClassicState;
    timestamp: number;
}) => {
    if (state.vaultTokenTotalSupply.eq(BIG_ZERO)) {
        return;
    }

    const stats = classicStatsFromState(state);

    for (const period of CLASSIC_SNAPSHOT_PERIODS) {
        const snapshot = await getOrCreateClassicSnapshot({ context, classic, timestamp, period });
        context.ClassicSnapshot.set({
            ...snapshot,
            blockTimestamp: new Date(timestamp * 1000),
            ...stats,
        });
    }
};

export const incrementClassicSnapshotFees = async ({
    context,
    classic,
    timestamp,
    callFees,
    beefyFees,
    strategistFees,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    timestamp: number;
    callFees: BigDecimal;
    beefyFees: BigDecimal;
    strategistFees: BigDecimal;
}) => {
    for (const period of CLASSIC_SNAPSHOT_PERIODS) {
        const snapshot = await getOrCreateClassicSnapshot({ context, classic, timestamp, period });
        context.ClassicSnapshot.set({
            ...snapshot,
            totalCallFees: snapshot.totalCallFees.plus(callFees),
            totalBeefyFees: snapshot.totalBeefyFees.plus(beefyFees),
            totalStrategistFees: snapshot.totalStrategistFees.plus(strategistFees),
        });
    }
};
