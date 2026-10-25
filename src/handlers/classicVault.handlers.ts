import { indexer } from 'envio';
import { handleShareTransfer } from '../lib/balances';
import { isVaultBlacklisted } from '../lib/blacklist';
import { registerClassicStrategy } from '../lib/register';
import { ensureContract, writeEventLink } from '../lib/registry';

indexer.onEvent({ contract: 'ClassicVault', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'VAULT');
});

indexer.contractRegister({ contract: 'ClassicVault', event: 'UpgradeStrat' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.implementation)) return;
    registerClassicStrategy(context, event.chainId, event.params.implementation);
});

indexer.onEvent({ contract: 'ClassicVault', event: 'UpgradeStrat' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'VAULT'))) return;
    writeEventLink(context, event, 'VAULT_STRATEGY', event.params.implementation);
});

indexer.onEvent({ contract: 'ClassicVault', event: 'Transfer' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'VAULT'))) return;
    await handleShareTransfer(context, event);
});
