import { ClassicStrategyFactory } from 'generated';
import { isVaultBlacklisted } from '../lib/blacklist';

ClassicStrategyFactory.StrategyCreated.contractRegister(async ({ event, context }) => {
    const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.addClassicStrategy(contractAddress);

    context.log.info('ClassicStrategyCreated', { contractAddress });
});
