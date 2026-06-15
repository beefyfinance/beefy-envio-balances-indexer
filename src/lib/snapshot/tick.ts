import type { ClockTick, EvmChainId, EvmOnEventContext } from 'envio';
import { getIntervalFromTimestamp } from '../time/interval';
import { clockTickId } from './clm';

export const getOrCreateClockTick = async ({
    context,
    chainId,
    timestamp,
    period,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    timestamp: number;
    period: number;
}): Promise<{ tick: ClockTick; isNew: boolean }> => {
    const roundedTimestamp = getIntervalFromTimestamp(timestamp, period);
    const id = clockTickId({ chainId, period, roundedTimestamp });
    const existing = await context.ClockTick.get(id);
    if (existing) {
        return { tick: existing, isNew: false };
    }

    const tick: ClockTick = {
        id,
        chainId,
        period: BigInt(period),
        roundedTimestamp: new Date(roundedTimestamp * 1000),
        blockTimestamp: new Date(timestamp * 1000),
    };

    context.ClockTick.set(tick);
    return { tick, isNew: true };
};
