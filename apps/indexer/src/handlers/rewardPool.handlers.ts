import { indexer } from 'envio';

import { handleShareTransfer } from '../lib/balances';
import { eventColumns } from '../lib/event';
import { asHex } from '../lib/hex';
import { ensureContract, ensureToken, writeEventLink } from '../lib/registry';
import { writeTimelineEvent } from '../lib/timeline';

indexer.onEvent({ contract: 'RewardPool', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'REWARD_POOL');
});

indexer.onEvent({ contract: 'RewardPool', event: 'Transfer' }, async ({ event, context }) => {
    const contract = await ensureContract(context, event, 'REWARD_POOL');
    if (!contract) return;
    await handleShareTransfer(context, event, contract);
});

indexer.onEvent({ contract: 'RewardPool', event: 'AddReward' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'REWARD_POOL'))) return;
    await ensureToken(context, event.chainId, event.params.reward, false);
    writeEventLink(context, event, 'REWARD_POOL_REWARD', event.params.reward);
});

indexer.onEvent({ contract: 'RewardPool', event: 'NotifyReward' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'REWARD_POOL'))) return;
    context.RewardNotified.set({
        ...eventColumns(event),
        contract: asHex(event.srcAddress),
        source: 'REWARD_POOL',
        rewardToken: asHex(event.params.reward),
        amount: event.params.amount,
        duration: event.params.duration,
    });
});

indexer.onEvent({ contract: 'RewardPool', event: 'RewardPaid' }, async ({ event, context }) => {
    const contract = await ensureContract(context, event, 'REWARD_POOL');
    if (!contract) return;
    context.RewardPaid.set({
        ...eventColumns(event),
        contract: asHex(event.srcAddress),
        source: 'REWARD_POOL',
        user: asHex(event.params.user),
        rewardToken: asHex(event.params.reward),
        amount: event.params.amount,
    });
    writeTimelineEvent(context, event, contract, event.params.user, 'CLAIM', {
        rewardToken: asHex(event.params.reward),
        rewardAmount: event.params.amount,
    });
});
