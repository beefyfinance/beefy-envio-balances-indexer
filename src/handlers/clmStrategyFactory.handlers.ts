import { ClmStrategyFactory } from 'generated';
import { isVaultBlacklisted } from '../lib/blacklist';

ClmStrategyFactory.ClmStrategyCreated.contractRegister(async ({ event, context }) => {
    const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.addClmStrategy(contractAddress);

    context.log.info('ClmStrategyCreated', { contractAddress });
});
