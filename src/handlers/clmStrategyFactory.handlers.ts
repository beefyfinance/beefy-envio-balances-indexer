import { indexer } from 'envio';
import { isVaultBlacklisted } from '../lib/blacklist';

indexer.contractRegister(
    { contract: 'ClmStrategyFactory', event: 'ClmStrategyCreated' },
    async ({ event, context }) => {
        const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
        if (isVaultBlacklisted(event.chainId, contractAddress)) return;

        context.chain.ClmStrategy.add(contractAddress);

        context.log.info('ClmStrategyCreated', { contractAddress });
    }
);
