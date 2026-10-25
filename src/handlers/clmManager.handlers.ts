import { indexer } from 'envio';
import { handleShareTransfer } from '../lib/balances';
import { eventColumns } from '../lib/event';
import { asHex } from '../lib/hex';
import { ensureContract } from '../lib/registry';

indexer.onEvent({ contract: 'ClmManager', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'CLM_MANAGER');
});

indexer.onEvent({ contract: 'ClmManager', event: 'Transfer' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_MANAGER'))) return;
    await handleShareTransfer(context, event);
});

indexer.onEvent({ contract: 'ClmManager', event: 'Deposit' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_MANAGER'))) return;
    context.ClmDeposit.set({
        ...eventColumns(event),
        manager: asHex(event.srcAddress),
        user: asHex(event.params.user),
        shares: event.params.shares,
        amount0: event.params.amount0,
        amount1: event.params.amount1,
        fee0: event.params.fee0,
        fee1: event.params.fee1,
    });
});

indexer.onEvent({ contract: 'ClmManager', event: 'Withdraw' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_MANAGER'))) return;
    context.ClmWithdraw.set({
        ...eventColumns(event),
        manager: asHex(event.srcAddress),
        user: asHex(event.params.user),
        shares: event.params.shares,
        amount0: event.params.amount0,
        amount1: event.params.amount1,
    });
});
