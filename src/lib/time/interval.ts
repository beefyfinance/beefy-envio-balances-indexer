export const MINUTES_15 = 60 * 15;
export const HOUR = 60 * 60;
export const DAY = 60 * 60 * 24;
export const WEEK = 60 * 60 * 24 * 7;
export const MONTH = 60 * 60 * 24 * 30;
export const QUARTER = 60 * 60 * 24 * 30 * 3;
export const YEAR = 60 * 60 * 24 * 365;

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
