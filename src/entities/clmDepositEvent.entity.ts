import type { Account, Clm, ClmDepositEvent, EvmChainId, EvmOnEventContext } from 'envio';
import type { BigDecimal } from '../lib/decimal';
import { type EventMetadata, getEventFields } from '../lib/event';

export const createClmDepositEvent = async ({
    context,
    chainId,
    clm,
    account,
    shares,
    amount0,
    amount1,
    fee0,
    fee1,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    clm: Clm;
    account: Account;
    shares: BigDecimal;
    amount0: BigDecimal;
    amount1: BigDecimal;
    fee0: BigDecimal;
    fee1: BigDecimal;
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });
    const existing = await context.ClmDepositEvent.get(fields.id);
    if (existing) {
        return existing;
    }

    const depositEvent: ClmDepositEvent = {
        ...fields,
        clm_id: clm.id,
        account_id: account.id,
        shares,
        amount0,
        amount1,
        fee0,
        fee1,
    };

    context.ClmDepositEvent.set(depositEvent);
    return depositEvent;
};
