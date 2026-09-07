import { indexer } from 'envio';
import { usesClassicStratHarvest1Abi } from '../config/classic/stratHarvest1';
import { isVaultBlacklisted } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { toBytes, toHex } from '../lib/hex';

indexer.contractRegister(
    { contract: 'ClassicStrategyFactory', event: 'StrategyCreated' },
    async ({ event, context }) => {
        const contractAddress = toBytes(event.params.proxy);
        if (isVaultBlacklisted(event.chainId, contractAddress)) return;

        const chainId = toChainId(event.chainId);
        context.chain.ClassicStrategy.add(toHex(contractAddress));
        if (usesClassicStratHarvest1Abi(chainId, contractAddress)) {
            context.chain.ClassicStrategyStratHarvest1.add(toHex(contractAddress));
        } else {
            context.chain.ClassicStrategyStratHarvest0.add(toHex(contractAddress));
        }

        context.log.info('ClassicStrategyCreated', { contractAddress });
    }
);
