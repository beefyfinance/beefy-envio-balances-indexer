import { DAY, getIntervalFromTimestamp, getPreviousIntervalFromTimestamp, HOUR, WEEK } from '../time/interval';

export const CLASSIC_SNAPSHOT_PERIODS = [HOUR, DAY, WEEK] as const;

export const classicSnapshotId = ({
    classicId,
    period,
    roundedTimestamp,
}: {
    classicId: string;
    period: number;
    roundedTimestamp: number;
}) => `${classicId}-${period}-${roundedTimestamp}`;

export const getClassicSnapshotIdForTimestamp = ({
    classicId,
    timestamp,
    period,
}: {
    classicId: string;
    timestamp: number;
    period: number;
}) => {
    const roundedTimestamp = getIntervalFromTimestamp(timestamp, period);
    return {
        id: classicSnapshotId({ classicId, period, roundedTimestamp }),
        roundedTimestamp,
    };
};

export const getPreviousClassicSnapshotIdForTimestamp = ({
    classicId,
    timestamp,
    period,
}: {
    classicId: string;
    timestamp: number;
    period: number;
}) => {
    const roundedTimestamp = getPreviousIntervalFromTimestamp(timestamp, period);
    return classicSnapshotId({ classicId, period, roundedTimestamp });
};
