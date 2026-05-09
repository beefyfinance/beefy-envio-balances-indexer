import { indexer } from 'envio';
import { isVaultBlacklisted } from '../lib/blacklist';

indexer.contractRegister(
    { contract: 'ClassicStrategyFactory', event: 'StrategyCreated' },
    async ({ event, context }) => {
        const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
        if (isVaultBlacklisted(event.chainId, contractAddress)) return;

        context.chain.ClassicStrategy.add(contractAddress);

        context.log.info('ClassicStrategyCreated', { contractAddress });
    }
);
