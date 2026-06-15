import type { EvmBlock, EvmChainId, EvmOnEventContext, RewardPool, Token } from 'envio';
import type { Hex } from 'viem';
import { normalizeHex } from '../lib/hex';

export const rewardPoolId = ({ chainId, rewardPoolAddress }: { chainId: EvmChainId; rewardPoolAddress: Hex }) =>
    `${chainId}-${normalizeHex(rewardPoolAddress)}`;

export const getRewardPool = async (context: EvmOnEventContext, chainId: EvmChainId, rewardPoolAddress: Hex) => {
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
    context: EvmOnEventContext;
    chainId: EvmChainId;
    rewardPoolAddress: Hex;
    shareToken: Token;
    underlyingToken: Token;
    initializedBlock: EvmBlock;
}): Promise<RewardPool> => {
    const id = rewardPoolId({ chainId, rewardPoolAddress });

    const rewardPool: RewardPool = {
        id,
        chainId,
        address: rewardPoolAddress,
        shareToken_id: shareToken.id,
        underlyingToken_id: underlyingToken.id,
        classic_id: undefined,
        clm_id: undefined,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.RewardPool.set(rewardPool);
    return rewardPool;
};

export const isRewardPool = async (context: EvmOnEventContext, chainId: EvmChainId, rewardPoolAddress: Hex) => {
    const id = rewardPoolId({ chainId, rewardPoolAddress });
    const rewardPool = await context.RewardPool.get(id);
    return rewardPool !== undefined;
};
