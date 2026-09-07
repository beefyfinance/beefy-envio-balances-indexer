import { indexer } from 'envio';
import { isVaultBlacklisted } from '../lib/blacklist';
import { toBytes, toHex } from '../lib/hex';

indexer.contractRegister({ contract: 'RewardPoolFactory', event: 'RewardPoolCreated' }, async ({ event, context }) => {
    const contractAddress = toBytes(event.params.proxy);
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.chain.RewardPool.add(toHex(contractAddress));

    context.log.info('RewardPoolCreated', { contractAddress });
});

indexer.contractRegister(
    { contract: 'RewardPoolFactory', event: 'RewardPoolCreatedWithName' },
    async ({ event, context }) => {
        const contractAddress = toBytes(event.params.proxy);
        if (isVaultBlacklisted(event.chainId, contractAddress)) return;

        context.chain.RewardPool.add(toHex(contractAddress));

        context.log.info('RewardPoolCreatedWithName', { contractAddress });
    }
);
