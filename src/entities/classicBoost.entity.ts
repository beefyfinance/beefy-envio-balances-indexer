import type { Classic, ClassicBoost, EvmBlock, EvmChainId, EvmOnEventContext, Token } from 'envio';
import { type Bytes, toHex } from '../lib/hex';
export const classicBoostId = ({ chainId, boostAddress }: { chainId: EvmChainId; boostAddress: Bytes }) =>
    `${chainId}-${toHex(boostAddress)}`;

export const getClassicBoost = async (context: EvmOnEventContext, chainId: EvmChainId, boostAddress: Bytes) => {
    const id = classicBoostId({ chainId, boostAddress });
    const boost = await context.ClassicBoost.get(id);
    return boost;
};

export const createClassicBoost = async ({
    context,
    chainId,
    boostAddress,
    shareToken,
    underlyingToken,
    rewardToken,
    classic,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    boostAddress: Bytes;
    shareToken: Token;
    underlyingToken: Token;
    rewardToken: Token;
    classic?: Classic;
    initializedBlock: EvmBlock;
}): Promise<ClassicBoost> => {
    const id = classicBoostId({ chainId, boostAddress });

    const boost: ClassicBoost = {
        id,
        address: boostAddress,
        shareToken_id: shareToken.id,
        underlyingToken_id: underlyingToken.id,
        rewardToken_id: rewardToken.id,
        classic_id: classic?.id,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.ClassicBoost.set(boost);
    return boost;
};

export const isClassicBoost = async (context: EvmOnEventContext, chainId: EvmChainId, boostAddress: Bytes) => {
    const id = classicBoostId({ chainId, boostAddress });
    const boost = await context.ClassicBoost.get(id);
    return boost !== undefined;
};
