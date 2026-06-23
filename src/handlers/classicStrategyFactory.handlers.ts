import { indexer } from 'envio';
import { usesClassicStratHarvest1Abi } from '../config/classic/stratHarvest1';
import { isVaultBlacklisted } from '../lib/blacklist';
import { toChainId } from '../lib/chain';

indexer.contractRegister(
    { contract: 'ClassicStrategyFactory', event: 'StrategyCreated' },
    async ({ event, context }) => {
        const contractAddress = event.params.proxy;
        if (isVaultBlacklisted(event.chainId, contractAddress)) return;

        const chainId = toChainId(event.chainId);
        context.chain.ClassicStrategy.add(contractAddress);
        if (usesClassicStratHarvest1Abi(chainId, contractAddress)) {
            context.chain.ClassicStrategyStratHarvest1.add(contractAddress);
        } else {
            context.chain.ClassicStrategyStratHarvest0.add(contractAddress);
        }

        context.log.info('ClassicStrategyCreated', { contractAddress });
    }
);
