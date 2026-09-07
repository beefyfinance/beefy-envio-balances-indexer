import type { Clm, ClmStrategy, ClmStrategyTvlEvent, EvmChainId, EvmOnEventContext } from 'envio';
import type { BigDecimal } from '../lib/decimal';
import { type EventMetadata, getEventFields } from '../lib/event';

export const createClmStrategyTvlEvent = async ({
    context,
    chainId,
    clm,
    strategy,
    underlyingAmount0,
    underlyingAmount1,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    strategy: ClmStrategy;
    underlyingAmount0: BigDecimal;
    underlyingAmount1: BigDecimal;
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });
    const existing = await context.ClmStrategyTvlEvent.get(fields.id);
    if (existing) {
        return existing;
    }

    const tvlEvent: ClmStrategyTvlEvent = {
        ...fields,
        clm_id: clm.id,
        clmStrategy_id: strategy.id,
        underlyingAmount0,
        underlyingAmount1,
    };

    context.ClmStrategyTvlEvent.set(tvlEvent);
    return tvlEvent;
};
