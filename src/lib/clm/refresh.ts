import type { Clm, EvmOnEventContext } from 'envio';
import type { ClmState } from '../../effects/clm.effects';
import { incrementClmFees, updateClmStats } from '../../entities/clm.entity';
import { incrementClmSnapshotFees, writeClmSnapshotFromState } from '../../entities/clmSnapshot.entity';
import type { BigDecimal } from '../decimal';

export const refreshClm = async ({
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
    await updateClmStats({
        context,
        clm,
        state,
    });

    await writeClmSnapshotFromState({
        context,
        clm,
        state,
        timestamp,
    });
};

export const refreshClmSnapshot = async ({
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
    await refreshClm({ context, clm, state, timestamp });
};

export const refreshClmFees = async ({
    context,
    clm,
    callFees,
    beefyFees,
    strategistFees,
    timestamp,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    callFees: BigDecimal;
    beefyFees: BigDecimal;
    strategistFees: BigDecimal;
    timestamp: number;
}) => {
    await incrementClmFees({
        context,
        clm,
        callFees,
        beefyFees,
        strategistFees,
    });

    await incrementClmSnapshotFees({
        context,
        clm,
        timestamp,
        callFees,
        beefyFees,
        strategistFees,
    });
};
