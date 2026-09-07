import type { ClassicErc4626Adapter, EvmBlock, EvmChainId, EvmOnEventContext, Token } from 'envio';
import { type Bytes, toHex } from '../lib/hex';
export const erc4626AdapterId = ({ chainId, adapterAddress }: { chainId: EvmChainId; adapterAddress: Bytes }) =>
    `${chainId}-${toHex(adapterAddress)}`;

export const getErc4626Adapter = async (context: EvmOnEventContext, chainId: EvmChainId, adapterAddress: Bytes) => {
    const id = erc4626AdapterId({ chainId, adapterAddress });
    const adapter = await context.ClassicErc4626Adapter.get(id);
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
    context: EvmOnEventContext;
    chainId: EvmChainId;
    adapterAddress: Bytes;
    shareToken: Token;
    underlyingToken: Token;
    initializedBlock: EvmBlock;
}): Promise<ClassicErc4626Adapter> => {
    const id = erc4626AdapterId({ chainId, adapterAddress });

    const adapter: ClassicErc4626Adapter = {
        id,
        address: adapterAddress,
        shareToken_id: shareToken.id,
        underlyingToken_id: underlyingToken.id,
        classic_id: undefined,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.ClassicErc4626Adapter.set(adapter);
    return adapter;
};

export const isErc4626Adapter = async (context: EvmOnEventContext, chainId: EvmChainId, adapterAddress: Bytes) => {
    const id = erc4626AdapterId({ chainId, adapterAddress });
    const adapter = await context.ClassicErc4626Adapter.get(id);
    return adapter !== undefined;
};
