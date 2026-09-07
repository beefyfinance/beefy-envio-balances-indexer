import type { Classic, EvmOnEventContext } from 'envio';
import type { ClassicState } from '../../effects/classic.effects';
import { incrementClassicFees, updateClassicStats } from '../../entities/classic.entity';
import { incrementClassicSnapshotFees, writeClassicSnapshotFromState } from '../../entities/classicSnapshot.entity';
import type { BigDecimal } from '../decimal';

export const refreshClassic = async ({
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
    await updateClassicStats({
        context,
        classic,
        state,
    });

    await writeClassicSnapshotFromState({
        context,
        classic,
        state,
        timestamp,
    });
};

export const refreshClassicSnapshot = async ({
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
    await refreshClassic({ context, classic, state, timestamp });
};

export const refreshClassicFees = async ({
    context,
    classic,
    callFees,
    beefyFees,
    strategistFees,
    timestamp,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    callFees: BigDecimal;
    beefyFees: BigDecimal;
    strategistFees: BigDecimal;
    timestamp: number;
}) => {
    await incrementClassicFees({
        context,
        classic,
        callFees,
        beefyFees,
        strategistFees,
    });

    await incrementClassicSnapshotFees({
        context,
        classic,
        timestamp,
        callFees,
        beefyFees,
        strategistFees,
    });
};
