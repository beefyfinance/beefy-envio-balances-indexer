/** Share tokens without product-specific events: LST vaults, ERC-4626 adapters, configured tokens (mooBIFI...). */
import { indexer } from 'envio';
import { handleShareTransfer } from '../lib/balances';
import { ensureContract } from '../lib/registry';

indexer.onEvent({ contract: 'LstVault', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'LST_VAULT');
});

indexer.onEvent({ contract: 'LstVault', event: 'Transfer' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'LST_VAULT'))) return;
    await handleShareTransfer(context, event);
});

indexer.onEvent({ contract: 'Erc4626Adapter', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'ERC4626_ADAPTER');
});

indexer.onEvent({ contract: 'Erc4626Adapter', event: 'Transfer' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'ERC4626_ADAPTER'))) return;
    await handleShareTransfer(context, event);
});

indexer.onEvent({ contract: 'Token', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'TOKEN');
});

indexer.onEvent({ contract: 'Token', event: 'Transfer' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'TOKEN'))) return;
    await handleShareTransfer(context, event);
});
