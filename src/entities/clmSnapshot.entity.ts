import type { Clm, ClmSnapshot, EvmOnEventContext } from 'envio';
import type { ClmState } from '../effects/clm.effects';
import { BIG_ZERO, type BigDecimal } from '../lib/decimal';
import {
    CLM_SNAPSHOT_PERIODS,
    getClmSnapshotIdForTimestamp,
    getPreviousClmSnapshotIdForTimestamp,
} from '../lib/snapshot/clm';
import { clmStatsFromState } from './clm.entity';

export const getOrCreateClmSnapshot = async ({
    context,
    clm,
    timestamp,
    period,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    timestamp: number;
    period: number;
}): Promise<ClmSnapshot> => {
    const { id, roundedTimestamp } = getClmSnapshotIdForTimestamp({ clmId: clm.id, timestamp, period });
    const existing = await context.ClmSnapshot.get(id);
    if (existing) {
        return existing;
    }

    const previousSnapshotId = getPreviousClmSnapshotIdForTimestamp({ clmId: clm.id, timestamp, period });
    const previousSnapshot = await context.ClmSnapshot.get(previousSnapshotId);

    const snapshot: ClmSnapshot = {
        id,
        clm_id: clm.id,
        period: BigInt(period),
        roundedTimestamp: new Date(roundedTimestamp * 1000),
        blockTimestamp: new Date(timestamp * 1000),
        managerTotalSupply: previousSnapshot?.managerTotalSupply ?? BIG_ZERO,
        rewardPoolsTotalSupply: previousSnapshot?.rewardPoolsTotalSupply ?? [],
        token0ToNativePrice: previousSnapshot?.token0ToNativePrice ?? BIG_ZERO,
        token1ToNativePrice: previousSnapshot?.token1ToNativePrice ?? BIG_ZERO,
        outputToNativePrices: previousSnapshot?.outputToNativePrices ?? [],
        rewardToNativePrices: previousSnapshot?.rewardToNativePrices ?? [],
        nativeToUSDPrice: previousSnapshot?.nativeToUSDPrice ?? BIG_ZERO,
        priceOfToken0InToken1: previousSnapshot?.priceOfToken0InToken1 ?? BIG_ZERO,
        priceRangeMin1: previousSnapshot?.priceRangeMin1 ?? BIG_ZERO,
        priceRangeMax1: previousSnapshot?.priceRangeMax1 ?? BIG_ZERO,
        totalUnderlyingAmount0: previousSnapshot?.totalUnderlyingAmount0 ?? BIG_ZERO,
        totalUnderlyingAmount1: previousSnapshot?.totalUnderlyingAmount1 ?? BIG_ZERO,
        underlyingMainAmount0: previousSnapshot?.underlyingMainAmount0 ?? BIG_ZERO,
        underlyingMainAmount1: previousSnapshot?.underlyingMainAmount1 ?? BIG_ZERO,
        underlyingAltAmount0: previousSnapshot?.underlyingAltAmount0 ?? BIG_ZERO,
        underlyingAltAmount1: previousSnapshot?.underlyingAltAmount1 ?? BIG_ZERO,
        totalCallFees: BIG_ZERO,
        totalBeefyFees: BIG_ZERO,
        totalStrategistFees: BIG_ZERO,
    };

    context.ClmSnapshot.set(snapshot);
    return snapshot;
};

export const writeClmSnapshotFromState = async ({
    context,
    clm,
    state,
    timestamp,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    state: ClmState;
    timestamp: number;
}) => {
    if (state.managerTotalSupply.eq(BIG_ZERO)) {
        return;
    }

    const stats = clmStatsFromState(state);

    for (const period of CLM_SNAPSHOT_PERIODS) {
        const snapshot = await getOrCreateClmSnapshot({ context, clm, timestamp, period });
        context.ClmSnapshot.set({
            ...snapshot,
            blockTimestamp: new Date(timestamp * 1000),
            ...stats,
        });
    }
};

export const incrementClmSnapshotFees = async ({
    context,
    clm,
    timestamp,
    callFees,
    beefyFees,
    strategistFees,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    timestamp: number;
    callFees: BigDecimal;
    beefyFees: BigDecimal;
    strategistFees: BigDecimal;
}) => {
    for (const period of CLM_SNAPSHOT_PERIODS) {
        const snapshot = await getOrCreateClmSnapshot({ context, clm, timestamp, period });
        context.ClmSnapshot.set({
            ...snapshot,
            totalCallFees: snapshot.totalCallFees.plus(callFees),
            totalBeefyFees: snapshot.totalBeefyFees.plus(beefyFees),
            totalStrategistFees: snapshot.totalStrategistFees.plus(strategistFees),
        });
    }
};
