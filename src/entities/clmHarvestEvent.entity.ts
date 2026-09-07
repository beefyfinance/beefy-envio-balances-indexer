import type { Clm, ClmHarvestEvent, ClmStrategy, EvmChainId, EvmOnEventContext } from 'envio';
import type { ClmState } from '../effects/clm.effects';
import type { BigDecimal } from '../lib/decimal';
import { type EventMetadata, getEventFields } from '../lib/event';

export const createClmHarvestEvent = async ({
    context,
    chainId,
    clm,
    strategy,
    state,
    compoundedAmount0,
    compoundedAmount1,
    collectedOutputAmounts,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    strategy: ClmStrategy;
    state: ClmState;
    compoundedAmount0: BigDecimal;
    compoundedAmount1: BigDecimal;
    collectedOutputAmounts: BigDecimal[];
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });
    const existing = await context.ClmHarvestEvent.get(fields.id);
    if (existing) {
        return existing;
    }

    const harvestEvent: ClmHarvestEvent = {
        ...fields,
        clm_id: clm.id,
        clmStrategy_id: strategy.id,
        underlyingAmount0: state.totalUnderlyingAmount0,
        underlyingAmount1: state.totalUnderlyingAmount1,
        compoundedAmount0,
        compoundedAmount1,
        collectedOutputAmounts,
        managerTotalSupply: state.managerTotalSupply,
        rewardPoolsTotalSupply: state.rewardPoolsTotalSupply,
        token0ToNativePrice: state.token0ToNativePrice,
        token1ToNativePrice: state.token1ToNativePrice,
        outputToNativePrices: state.outputToNativePrices,
        rewardToNativePrices: state.rewardToNativePrices,
        nativeToUSDPrice: state.nativeToUSDPrice,
    };

    context.ClmHarvestEvent.set(harvestEvent);
    return harvestEvent;
};
