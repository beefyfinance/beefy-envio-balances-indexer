import { describe, expect, it } from 'vitest';
import { getIntervalFromTimestamp, HOUR } from '../time/interval';
import { clockTickId } from './clm';
import { getOrCreateClockTick } from './tick';

describe('snapshot tick', () => {
    describe('clockTickId', () => {
        it('Should build id from chain, period, and rounded timestamp', () => {
            const timestamp = Math.floor(Date.parse('2024-06-10T12:34:56.000Z') / 1000);
            const rounded = getIntervalFromTimestamp(timestamp, HOUR);
            expect(clockTickId({ chainId: 8453, period: HOUR, roundedTimestamp: rounded })).toBe(
                `8453-${HOUR.toString()}-${rounded.toString()}`
            );
        });
    });

    describe('getOrCreateClockTick', () => {
        const timestamp = Math.floor(Date.parse('2024-06-10T12:34:56.000Z') / 1000);
        const rounded = getIntervalFromTimestamp(timestamp, HOUR);
        const id = clockTickId({ chainId: 8453, period: HOUR, roundedTimestamp: rounded });

        it('Should create a new tick when none exists', async () => {
            const store = new Map<string, unknown>();
            const context = {
                ClockTick: {
                    get: async (tickId: string) => store.get(tickId) ?? undefined,
                    set: (tick: { id: string }) => {
                        store.set(tick.id, tick);
                    },
                },
            };

            const { tick, isNew } = await getOrCreateClockTick({
                context: context as never,
                chainId: 8453,
                timestamp,
                period: HOUR,
            });

            expect(isNew).toBe(true);
            expect(tick.id).toBe(id);
            expect(tick.chainId).toBe(8453);
            expect(tick.period).toBe(BigInt(HOUR));
            expect(tick.roundedTimestamp).toEqual(new Date(rounded * 1000));
            expect(tick.blockTimestamp).toEqual(new Date(timestamp * 1000));
            expect(store.get(id)).toEqual(tick);
        });

        it('Should return existing tick without overwriting', async () => {
            const existing = {
                id,
                chainId: 8453,
                period: BigInt(HOUR),
                roundedTimestamp: new Date(rounded * 1000),
                blockTimestamp: new Date(timestamp * 1000),
            };
            const store = new Map([[id, existing]]);
            let setCalls = 0;
            const context = {
                ClockTick: {
                    get: async (tickId: string) => store.get(tickId) ?? undefined,
                    set: () => {
                        setCalls += 1;
                    },
                },
            };

            const { tick, isNew } = await getOrCreateClockTick({
                context: context as never,
                chainId: 8453,
                timestamp,
                period: HOUR,
            });

            expect(isNew).toBe(false);
            expect(tick).toBe(existing);
            expect(setCalls).toBe(0);
        });
    });
});
