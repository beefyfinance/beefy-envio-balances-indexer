import { indexer } from 'envio';
import { isVaultBlacklisted } from '../lib/blacklist';
import { toBytes, toHex } from '../lib/hex';

indexer.contractRegister(
    { contract: 'ClmStrategyFactory', event: 'ClmStrategyCreated' },
    async ({ event, context }) => {
        const contractAddress = toBytes(event.params.proxy);
        if (isVaultBlacklisted(event.chainId, contractAddress)) return;

        context.chain.ClmStrategy.add(toHex(contractAddress));

        context.log.info('ClmStrategyCreated', { contractAddress });
    }
);
