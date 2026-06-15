import { indexer } from 'envio';
import { isVaultBlacklisted } from '../lib/blacklist';

indexer.contractRegister(
    { contract: 'ClassicStrategyFactory', event: 'StrategyCreated' },
    async ({ event, context }) => {
        const contractAddress = event.params.proxy;
        if (isVaultBlacklisted(event.chainId, contractAddress)) return;

        context.chain.ClassicStrategy.add(contractAddress);
        context.chain.ClassicStrategyStratHarvest0.add(contractAddress);

        context.log.info('ClassicStrategyCreated', { contractAddress });
    }
);
