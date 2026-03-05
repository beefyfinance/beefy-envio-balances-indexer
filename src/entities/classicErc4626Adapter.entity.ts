import type { Hex } from 'viem';
import type { ChainId } from '../lib/chain';
import type { Block, Erc4626Adapter_t, HandlerContext, Token_t } from '../lib/schema';

export const erc4626AdapterId = ({ chainId, adapterAddress }: { chainId: ChainId; adapterAddress: Hex }) =>
    `${chainId}-${adapterAddress.toLowerCase()}`;

export const getErc4626Adapter = async (context: HandlerContext, chainId: ChainId, adapterAddress: Hex) => {
    const id = erc4626AdapterId({ chainId, adapterAddress });
    const adapter = await context.Erc4626Adapter.get(id);
    return adapter;
};

export const createErc4626Adapter = async ({
    context,
    chainId,
    adapterAddress,
    shareToken,
    underlyingToken,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    adapterAddress: Hex;
    shareToken: Token_t;
    underlyingToken: Token_t;
    initializedBlock: Block;
}): Promise<Erc4626Adapter_t> => {
    const id = erc4626AdapterId({ chainId, adapterAddress });

    const adapter: Erc4626Adapter_t = {
        id,
        chainId,
        address: adapterAddress,
        shareToken_id: shareToken.id,
        underlyingToken_id: underlyingToken.id,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.Erc4626Adapter.set(adapter);
    return adapter;
};

export const isErc4626Adapter = async (context: HandlerContext, chainId: ChainId, adapterAddress: Hex) => {
    const id = erc4626AdapterId({ chainId, adapterAddress });
    const adapter = await context.Erc4626Adapter.get(id);
    return adapter !== undefined;
};
