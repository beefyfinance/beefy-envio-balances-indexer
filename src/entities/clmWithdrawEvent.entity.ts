import type { Account, Clm, ClmWithdrawEvent, EvmChainId, EvmOnEventContext } from 'envio';
import type { BigDecimal } from '../lib/decimal';
import { type EventMetadata, getEventFields } from '../lib/event';

export const createClmWithdrawEvent = async ({
    context,
    chainId,
    clm,
    account,
    shares,
    amount0,
    amount1,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    account: Account;
    shares: BigDecimal;
    amount0: BigDecimal;
    amount1: BigDecimal;
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });
    const existing = await context.ClmWithdrawEvent.get(fields.id);
    if (existing) {
        return existing;
    }

    const withdrawEvent: ClmWithdrawEvent = {
        ...fields,
        clm_id: clm.id,
        account_id: account.id,
        shares,
        amount0,
        amount1,
    };

    context.ClmWithdrawEvent.set(withdrawEvent);
    return withdrawEvent;
};
