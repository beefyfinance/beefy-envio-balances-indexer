import type { Classic, ClassicHarvestEvent, ClassicVaultStrategy, EvmChainId, EvmOnEventContext } from 'envio';
import type { ClassicState } from '../effects/classic.effects';
import type { BigDecimal } from '../lib/decimal';
import { type EventMetadata, getEventFields } from '../lib/event';

export const createClassicHarvestEvent = async ({
    context,
    chainId,
    classic,
    strategy,
    state,
    compoundedAmount,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    strategy: ClassicVaultStrategy;
    state: ClassicState;
    compoundedAmount: BigDecimal;
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });
    const existing = await context.ClassicHarvestEvent.get(fields.id);
    if (existing) {
        return existing;
    }

    const harvestEvent: ClassicHarvestEvent = {
        ...fields,
        classic_id: classic.id,
        classicVaultStrategy_id: strategy.id,
        underlyingAmount: state.underlyingAmount,
        compoundedAmount,
        vaultTokenTotalSupply: state.vaultTokenTotalSupply,
        rewardPoolsTotalSupply: state.rewardPoolsTotalSupply,
        underlyingToNativePrice: state.underlyingToNativePrice,
        boostRewardToNativePrices: state.boostRewardToNativePrices,
        rewardToNativePrices: state.rewardToNativePrices,
        nativeToUSDPrice: state.nativeToUSDPrice,
    };

    context.ClassicHarvestEvent.set(harvestEvent);
    return harvestEvent;
};
