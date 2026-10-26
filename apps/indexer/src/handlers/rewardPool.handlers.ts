import { indexer } from 'envio';

import { handleShareTransfer } from '../lib/balances';
import { eventColumns } from '../lib/event';
import { asHex } from '../lib/hex';
import { ensureContract, ensureToken, writeEventLink } from '../lib/registry';

indexer.onEvent({ contract: 'RewardPool', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'REWARD_POOL');
});

indexer.onEvent({ contract: 'RewardPool', event: 'Transfer' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'REWARD_POOL'))) return;
    await handleShareTransfer(context, event);
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
    if (!(await ensureContract(context, event, 'REWARD_POOL'))) return;
    context.RewardPaid.set({
        ...eventColumns(event),
        contract: asHex(event.srcAddress),
        source: 'REWARD_POOL',
        user: asHex(event.params.user),
        rewardToken: asHex(event.params.reward),
        amount: event.params.amount,
    });
});
