import { indexer } from 'envio';
import { isVaultBlacklisted } from '../lib/blacklist';

indexer.contractRegister({ contract: 'ClmManagerFactory', event: 'ClmManagerCreated' }, async ({ event, context }) => {
    const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.chain.ClmManager.add(contractAddress);

    context.log.info('ClmManagerCreated', { contractAddress });
});
