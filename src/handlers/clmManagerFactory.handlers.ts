import { isVaultBlacklisted } from '../lib/blacklist';
import { ClmManagerFactory_h } from '../lib/schema';

ClmManagerFactory_h.ClmManagerCreated.contractRegister(async ({ event, context }) => {
    const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.addClmManager(contractAddress);

    context.log.info('ClmManagerCreated', { contractAddress });
});
