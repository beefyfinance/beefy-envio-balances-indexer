export const MINUTES_15 = 60 * 15;
export const HOUR = 60 * 60;
export const DAY = 60 * 60 * 24;
export const WEEK = 60 * 60 * 24 * 7;
export const MONTH = 60 * 60 * 24 * 30;
export const QUARTER = 60 * 60 * 24 * 30 * 3;
export const YEAR = 60 * 60 * 24 * 365;

/** Approximate mean block time (seconds) per chain for onBlock stride sizing. */
const MEAN_BLOCK_TIME_SECONDS: Record<number, number> = {
    1: 12,
    10: 2,
    25: 6,
    30: 30,
    56: 3,
    100: 5,
    137: 2,
    143: 1,
    146: 1,
    250: 1,
    252: 2,
    324: 1,
    999: 1,
    1088: 2,
    1101: 2,
    1135: 2,
    1284: 12,
    1285: 12,
    1329: 1,
    2222: 6,
    4326: 1,
    5000: 2,
    8453: 2,
    9745: 1,
    80094: 2,
    42161: 1,
    43114: 2,
    59144: 2,
    534352: 3,
};

/** Blocks per hour at the chain's approximate mean block time (minimum 1). */
export const getApproxBlocksPerHour = (chainId: number): number => {
    const blockTime = MEAN_BLOCK_TIME_SECONDS[chainId] ?? 12;
    return Math.max(1, Math.floor(HOUR / blockTime));
};

export const getIntervalFromTimestamp = (timestamp: number, period: number): number => {
    if (period >= WEEK) {
        const date = new Date(timestamp * 1000);
        date.setUTCMilliseconds(0);
        date.setUTCSeconds(0);
        date.setUTCMinutes(0);
        date.setUTCHours(0);
        date.setUTCDate(date.getUTCDate() - date.getUTCDay());
        if (period === WEEK) {
            return Math.floor(date.getTime() / 1000);
        }
        date.setUTCDate(1);
        if (period === MONTH) {
            return Math.floor(date.getTime() / 1000);
        }
        date.setUTCMonth(date.getUTCMonth() - (date.getUTCMonth() % 3));
        if (period === QUARTER) {
            return Math.floor(date.getTime() / 1000);
        }
        date.setUTCMonth(0);
        if (period === YEAR) {
            return Math.floor(date.getTime() / 1000);
        }
        period = DAY;
    } else if (period === 0) {
        return timestamp;
    }
    return Math.floor(timestamp / period) * period;
};

export const getPreviousIntervalFromTimestamp = (timestamp: number, period: number): number => {
    const truncated = getIntervalFromTimestamp(timestamp, period);
    return getIntervalFromTimestamp(truncated - 10, period);
};
