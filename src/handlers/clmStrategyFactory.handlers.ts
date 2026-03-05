import { isVaultBlacklisted } from '../lib/blacklist';
import { ClmStrategyFactory_h } from '../lib/schema';

ClmStrategyFactory_h.ClmStrategyCreated.contractRegister(async ({ event, context }) => {
    const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.addClmStrategy(contractAddress);

    context.log.info('ClmStrategyCreated', { contractAddress });
});
