import type { Clm, ClmManagerCollectionEvent, ClmStrategy, EvmChainId, EvmOnEventContext } from 'envio';
import type { ClmState } from '../effects/clm.effects';
import type { BigDecimal } from '../lib/decimal';
import { type EventMetadata, getEventFields } from '../lib/event';

export const createClmManagerCollectionEvent = async ({
    context,
    chainId,
    clm,
    strategy,
    state,
    collectedAmount0,
    collectedAmount1,
    collectedOutputAmounts,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    strategy: ClmStrategy;
    state: ClmState;
    collectedAmount0: BigDecimal;
    collectedAmount1: BigDecimal;
    collectedOutputAmounts: BigDecimal[];
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });
    const existing = await context.ClmManagerCollectionEvent.get(fields.id);
    if (existing) {
        return existing;
    }

    const collectionEvent: ClmManagerCollectionEvent = {
        ...fields,
        clm_id: clm.id,
        clmStrategy_id: strategy.id,
        underlyingMainAmount0: state.underlyingMainAmount0,
        underlyingMainAmount1: state.underlyingMainAmount1,
        underlyingAltAmount0: state.underlyingAltAmount0,
        underlyingAltAmount1: state.underlyingAltAmount1,
        underlyingAmount0: state.totalUnderlyingAmount0,
        underlyingAmount1: state.totalUnderlyingAmount1,
        collectedAmount0,
        collectedAmount1,
        collectedOutputAmounts,
        token0ToNativePrice: state.token0ToNativePrice,
        token1ToNativePrice: state.token1ToNativePrice,
        outputToNativePrices: state.outputToNativePrices,
        rewardToNativePrices: state.rewardToNativePrices,
        nativeToUSDPrice: state.nativeToUSDPrice,
    };

    context.ClmManagerCollectionEvent.set(collectionEvent);
    return collectionEvent;
};
