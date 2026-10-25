import type { EvmOnEventContext } from 'envio';
import { eventColumns, type RawEvent } from './event';
import { asHex } from './hex';

export const writePauseChange = (
    context: EvmOnEventContext,
    event: RawEvent & { params: { account: string } },
    paused: boolean
) => {
    context.PauseChange.set({
        ...eventColumns(event),
        contract: asHex(event.srcAddress),
        paused,
        account: asHex(event.params.account),
    });
};
