import type { ChainId } from '@beefyfinance/blockchain-addressbook';
import type { EvmOnEventContext, RewardPoolRewardedEvent, Token } from 'envio';
import type { BigDecimal } from '../lib/decimal';
import { type EventMetadata, getEventFields } from '../lib/event';

export const createRewardPoolRewardedEvent = async ({
    context,
    chainId,
    poolShareToken,
    rewardToken,
    rewardVestingSeconds,
    rewardAmount,
    event,
}: {
    context: EvmOnEventContext;
    chainId: ChainId;
    poolShareToken: Token;
    rewardToken: Token;
    rewardVestingSeconds: bigint;
    rewardAmount: BigDecimal;
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });

    const rewardPoolRewardedEvent: RewardPoolRewardedEvent = {
        ...fields,
        poolShareToken_id: poolShareToken.id,
        rewardToken_id: rewardToken.id,
        rewardAmount,
        rewardVestingSeconds,
    };

    context.log.debug('Creating RewardPoolRewardedEvent', rewardPoolRewardedEvent);

    const evt = await context.RewardPoolRewardedEvent.get(fields.id);
    if (evt) {
        throw new Error(`RewardPoolRewardedEvent ${fields.id} already exists`);
    }

    context.RewardPoolRewardedEvent.set(rewardPoolRewardedEvent);
    return rewardPoolRewardedEvent;
};
