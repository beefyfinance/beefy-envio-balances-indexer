import type { Block_t, handlerContext as HandlerContext } from 'generated';
import type { ClassicBoost_t, Token_t } from 'generated/src/db/Entities.gen';
import type { Hex } from 'viem';
import type { ChainId } from '../lib/chain';

export const classicBoostId = ({ chainId, boostAddress }: { chainId: ChainId; boostAddress: Hex }) =>
    `${chainId}-${boostAddress.toLowerCase()}`;

export const getClassicBoost = async (context: HandlerContext, chainId: ChainId, boostAddress: Hex) => {
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
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    boostAddress: Hex;
    shareToken: Token_t;
    underlyingToken: Token_t;
    initializedBlock: Block_t;
}): Promise<ClassicBoost_t> => {
    const id = classicBoostId({ chainId, boostAddress });

    const boost: ClassicBoost_t = {
        id,
        chainId,
        address: boostAddress,
        shareToken_id: shareToken.id,
        underlyingToken_id: underlyingToken.id,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.ClassicBoost.set(boost);
    return boost;
};

export const isClassicBoost = async (context: HandlerContext, chainId: ChainId, boostAddress: Hex) => {
    const id = classicBoostId({ chainId, boostAddress });
    const boost = await context.ClassicBoost.get(id);
    return boost !== undefined;
};
