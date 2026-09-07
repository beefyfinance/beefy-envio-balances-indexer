import { DAY, getIntervalFromTimestamp, getPreviousIntervalFromTimestamp, HOUR, WEEK } from '../time/interval';

export const CLM_SNAPSHOT_PERIODS = [HOUR, DAY, WEEK] as const;

export const clmSnapshotId = ({
    clmId,
    period,
    roundedTimestamp,
}: {
    clmId: string;
    period: number;
    roundedTimestamp: number;
}) => `${clmId}-${period}-${roundedTimestamp}`;

export const getClmSnapshotIdForTimestamp = ({
    clmId,
    timestamp,
    period,
}: {
    clmId: string;
    timestamp: number;
    period: number;
}) => {
    const roundedTimestamp = getIntervalFromTimestamp(timestamp, period);
    return {
        id: clmSnapshotId({ clmId, period, roundedTimestamp }),
        roundedTimestamp,
    };
};

export const getPreviousClmSnapshotIdForTimestamp = ({
    clmId,
    timestamp,
    period,
}: {
    clmId: string;
    timestamp: number;
    period: number;
}) => {
    const roundedTimestamp = getPreviousIntervalFromTimestamp(timestamp, period);
    return clmSnapshotId({ clmId, period, roundedTimestamp });
};

export const clockTickId = ({
    chainId,
    period,
    roundedTimestamp,
}: {
    chainId: number;
    period: number;
    roundedTimestamp: number;
}) => `${chainId}-${period}-${roundedTimestamp}`;
