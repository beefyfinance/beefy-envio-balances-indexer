import { ClmManagerFactory } from 'generated';
import { isVaultBlacklisted } from '../lib/blacklist';

ClmManagerFactory.ClmManagerCreated.contractRegister(async ({ event, context }) => {
    const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.addClmManager(contractAddress);

    context.log.info('ClmManagerCreated', { contractAddress });
});
