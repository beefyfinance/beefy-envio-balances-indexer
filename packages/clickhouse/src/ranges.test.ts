import { describe, expect, it } from 'vitest';

import { planRanges } from './ranges.ts';
import { msOf } from './sql.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const limits = { maxEvents: 100, maxSpanMs: 7 * DAY, bucketMs: HOUR };
const at = (time: string): number => msOf(time);

describe('planRanges', () => {
    it('keeps a range with no event whole', () => {
        expect(planRanges({ from: '2024-01-01', to: '2024-03-01' }, [], limits)).toEqual([
            { from: '2024-01-01 00:00:00.000', to: '2024-03-01 00:00:00.000', events: 0 },
        ]);
    });

    it('cuts by event count, merging the empty time around events, and covers the range exactly', () => {
        const buckets = [
            { startMs: at('2024-01-02 00:00:00'), events: 60 },
            { startMs: at('2024-01-02 05:00:00'), events: 60 },
            { startMs: at('2024-01-03 00:00:00'), events: 30 },
        ];
        expect(planRanges({ from: '2024-01-01', to: '2024-01-10' }, buckets, limits)).toEqual([
            { from: '2024-01-01 00:00:00.000', to: '2024-01-02 05:00:00.000', events: 60 },
            { from: '2024-01-02 05:00:00.000', to: '2024-01-10 00:00:00.000', events: 90 },
        ]);
    });

    it('cuts a bucket holding more than the limit in equal parts of time', () => {
        const planned = planRanges(
            { from: '2024-01-01 00:00:00', to: '2024-01-01 01:00:00' },
            [{ startMs: at('2024-01-01'), events: 250 }],
            limits
        );
        expect(planned.map(({ events }) => events)).toEqual([83, 83, 84]);
        expect(planned.map(({ from }) => from)).toEqual([
            '2024-01-01 00:00:00.000',
            '2024-01-01 00:20:00.000',
            '2024-01-01 00:40:00.000',
        ]);
        expect(planned.at(-1)?.to).toBe('2024-01-01 01:00:00.000');
    });

    it('cuts by span, counted from the first event of a range, so a statement reads a bounded number of price days', () => {
        const buckets = Array.from({ length: 30 }, (_, day) => ({ startMs: at('2024-01-01') + day * DAY, events: 1 }));
        const planned = planRanges({ from: '2024-01-01', to: '2024-02-01' }, buckets, limits);
        expect(planned.map(({ events }) => events)).toEqual([7, 7, 7, 7, 2]);
        for (const { from, to } of planned.slice(0, -1)) expect(msOf(to ?? '') - msOf(from)).toBe(7 * DAY);
        expect(planned.reduce((sum, { events }) => sum + events, 0)).toBe(30);
    });

    it('leaves the last range open when the range is, and ignores buckets outside it', () => {
        const planned = planRanges(
            { from: '2024-01-02' },
            [
                { startMs: at('2024-01-01'), events: 500 },
                { startMs: at('2024-01-05'), events: 5 },
            ],
            limits
        );
        expect(planned).toEqual([{ from: '2024-01-02 00:00:00.000', events: 5 }]);
    });

    it('never holds more than the limit in a range, whatever the counts (the memory bound)', () => {
        const buckets = Array.from({ length: 2000 }, (_, hour) => ({
            startMs: at('2024-01-01') + hour * HOUR,
            events: (hour * 7919) % 260,
        }));
        const planned = planRanges({ from: '2024-01-01', to: '2024-04-01' }, buckets, limits);
        for (const { events } of planned) expect(events).toBeLessThanOrEqual(100);
        expect(planned.reduce((sum, { events }) => sum + events, 0)).toBe(
            buckets.reduce((sum, { events }) => sum + events, 0)
        );
        planned.slice(1).forEach(({ from }, index) => expect(from).toBe(planned[index]?.to));
    });
});
