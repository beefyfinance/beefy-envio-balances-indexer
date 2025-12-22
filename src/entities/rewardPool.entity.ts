import type { Block_t, handlerContext as HandlerContext } from 'generated';
import type { RewardPool_t, Token_t } from 'generated/src/db/Entities.gen';
import type { Hex } from 'viem';
import type { ChainId } from '../lib/chain';

export const rewardPoolId = ({ chainId, rewardPoolAddress }: { chainId: ChainId; rewardPoolAddress: Hex }) =>
    `${chainId}-${rewardPoolAddress.toLowerCase()}`;

export const getRewardPool = async (context: HandlerContext, chainId: ChainId, rewardPoolAddress: Hex) => {
    const id = rewardPoolId({ chainId, rewardPoolAddress });
    const rewardPool = await context.RewardPool.get(id);
    return rewardPool;
};

export const createRewardPool = async ({
    context,
    chainId,
    rewardPoolAddress,
    shareToken,
    underlyingToken,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    rewardPoolAddress: Hex;
    shareToken: Token_t;
    underlyingToken: Token_t;
    initializedBlock: Block_t;
}): Promise<RewardPool_t> => {
    const id = rewardPoolId({ chainId, rewardPoolAddress });

    const rewardPool: RewardPool_t = {
        id,
        chainId,
        address: rewardPoolAddress,
        shareToken_id: shareToken.id,
        underlyingToken_id: underlyingToken.id,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.RewardPool.set(rewardPool);
    return rewardPool;
};

export const isRewardPool = async (context: HandlerContext, chainId: ChainId, rewardPoolAddress: Hex) => {
    const id = rewardPoolId({ chainId, rewardPoolAddress });
    const rewardPool = await context.RewardPool.get(id);
    return rewardPool !== undefined;
};
