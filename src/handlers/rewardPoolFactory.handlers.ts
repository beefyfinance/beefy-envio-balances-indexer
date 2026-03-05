import { isVaultBlacklisted } from '../lib/blacklist';
import { RewardPoolFactory_h } from '../lib/schema';

RewardPoolFactory_h.RewardPoolCreated.contractRegister(async ({ event, context }) => {
    const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.addRewardPool(contractAddress);

    context.log.info('RewardPoolCreated', { contractAddress });
});

RewardPoolFactory_h.RewardPoolCreatedWithName.contractRegister(async ({ event, context }) => {
    const contractAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.addRewardPool(contractAddress);

    context.log.info('RewardPoolCreatedWithName', { contractAddress });
});
