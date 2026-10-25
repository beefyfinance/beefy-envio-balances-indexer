import { indexer } from 'envio';
import { handleBoostStake } from '../lib/balances';
import { eventColumns } from '../lib/event';
import { asHex } from '../lib/hex';
import { ensureContract } from '../lib/registry';

indexer.onEvent({ contract: 'ClassicBoost', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'BOOST');
});

indexer.onEvent({ contract: 'ClassicBoost', event: 'Staked' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'BOOST'))) return;
    await handleBoostStake(context, event, 'STAKE');
});

indexer.onEvent({ contract: 'ClassicBoost', event: 'Withdrawn' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'BOOST'))) return;
    await handleBoostStake(context, event, 'UNSTAKE');
});

indexer.onEvent({ contract: 'ClassicBoost', event: 'RewardAdded' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'BOOST'))) return;
    context.RewardNotified.set({
        ...eventColumns(event),
        contract: asHex(event.srcAddress),
        source: 'BOOST',
        rewardToken: undefined,
        amount: event.params.reward,
        duration: undefined,
    });
});

indexer.onEvent({ contract: 'ClassicBoost', event: 'RewardPaid' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'BOOST'))) return;
    context.RewardPaid.set({
        ...eventColumns(event),
        contract: asHex(event.srcAddress),
        source: 'BOOST',
        user: asHex(event.params.user),
        rewardToken: undefined,
        amount: event.params.reward,
    });
});
