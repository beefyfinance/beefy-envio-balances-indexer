/** Share tokens without product-specific events: LST vaults, ERC-4626 adapters, configured tokens (mooBIFI...). */
import { indexer } from 'envio';

import { handleShareTransfer } from '../lib/balances';
import { ensureContract } from '../lib/registry';

indexer.onEvent({ contract: 'LstVault', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'LST_VAULT');
});

indexer.onEvent({ contract: 'LstVault', event: 'Transfer' }, async ({ event, context }) => {
    const contract = await ensureContract(context, event, 'LST_VAULT');
    if (!contract) return;
    await handleShareTransfer(context, event, contract);
});

indexer.onEvent({ contract: 'Erc4626Adapter', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'ERC4626_ADAPTER');
});

indexer.onEvent({ contract: 'Erc4626Adapter', event: 'Transfer' }, async ({ event, context }) => {
    const contract = await ensureContract(context, event, 'ERC4626_ADAPTER');
    if (!contract) return;
    await handleShareTransfer(context, event, contract);
});

indexer.onEvent({ contract: 'Token', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'TOKEN');
});

indexer.onEvent({ contract: 'Token', event: 'Transfer' }, async ({ event, context }) => {
    const contract = await ensureContract(context, event, 'TOKEN');
    if (!contract) return;
    await handleShareTransfer(context, event, contract);
});
