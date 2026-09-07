import { describe, expect, it } from 'vitest';
import {
    DAY,
    getApproxBlocksPerHour,
    getIntervalFromTimestamp,
    getPreviousIntervalFromTimestamp,
    HOUR,
    MONTH,
    QUARTER,
    WEEK,
    YEAR,
} from './interval';

describe('interval', () => {
    describe('getApproxBlocksPerHour', () => {
        it('Should return ~1800 blocks per hour on Base (2s blocks)', () => {
            expect(getApproxBlocksPerHour(8453)).toBe(1800);
        });

        it('Should return at least 1 for unknown chains', () => {
            expect(getApproxBlocksPerHour(999_999)).toBe(300);
        });
    });

    describe('getIntervalFromTimestamp', () => {
        it('Should floor to hour boundary', () => {
            const ts = Math.floor(Date.parse('2024-06-10T12:34:56.000Z') / 1000);
            expect(getIntervalFromTimestamp(ts, HOUR)).toBe(Math.floor(Date.parse('2024-06-10T12:00:00.000Z') / 1000));
        });

        it('Should floor to day boundary when period is DAY', () => {
            const ts = Math.floor(Date.parse('2024-06-10T12:34:56.000Z') / 1000);
            expect(getIntervalFromTimestamp(ts, DAY)).toBe(Math.floor(Date.parse('2024-06-10T00:00:00.000Z') / 1000));
        });

        it('Should truncate to week start (Sunday UTC)', () => {
            // 2024-06-12 is Wednesday
            const ts = Math.floor(Date.parse('2024-06-12T15:00:00.000Z') / 1000);
            expect(getIntervalFromTimestamp(ts, WEEK)).toBe(Math.floor(Date.parse('2024-06-09T00:00:00.000Z') / 1000));
        });

        it('Should truncate to month start', () => {
            const ts = Math.floor(Date.parse('2024-06-15T12:00:00.000Z') / 1000);
            expect(getIntervalFromTimestamp(ts, MONTH)).toBe(Math.floor(Date.parse('2024-06-01T00:00:00.000Z') / 1000));
        });

        it('Should truncate to quarter start', () => {
            const ts = Math.floor(Date.parse('2024-05-15T12:00:00.000Z') / 1000);
            expect(getIntervalFromTimestamp(ts, QUARTER)).toBe(
                Math.floor(Date.parse('2024-04-01T00:00:00.000Z') / 1000)
            );
        });

        it('Should truncate to year start', () => {
            const ts = Math.floor(Date.parse('2024-08-01T12:00:00.000Z') / 1000);
            expect(getIntervalFromTimestamp(ts, YEAR)).toBe(Math.floor(Date.parse('2024-01-01T00:00:00.000Z') / 1000));
        });

        it('Should return timestamp unchanged when period is 0', () => {
            expect(getIntervalFromTimestamp(1_234_567, 0)).toBe(1_234_567);
        });
    });

    describe('getPreviousIntervalFromTimestamp', () => {
        it('Should return previous hour bucket', () => {
            const ts = Math.floor(Date.parse('2024-06-10T12:34:56.000Z') / 1000);
            expect(getPreviousIntervalFromTimestamp(ts, HOUR)).toBe(
                Math.floor(Date.parse('2024-06-10T11:00:00.000Z') / 1000)
            );
        });
    });
});
