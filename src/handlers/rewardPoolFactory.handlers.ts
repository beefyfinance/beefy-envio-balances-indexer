import { indexer } from 'envio';
import { isVaultBlacklisted } from '../lib/blacklist';

indexer.contractRegister({ contract: 'RewardPoolFactory', event: 'RewardPoolCreated' }, async ({ event, context }) => {
    const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.chain.RewardPool.add(contractAddress);

    context.log.info('RewardPoolCreated', { contractAddress });
});

indexer.contractRegister(
    { contract: 'RewardPoolFactory', event: 'RewardPoolCreatedWithName' },
    async ({ event, context }) => {
        const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
        if (isVaultBlacklisted(event.chainId, contractAddress)) return;

        context.chain.RewardPool.add(contractAddress);

        context.log.info('RewardPoolCreatedWithName', { contractAddress });
    }
);
