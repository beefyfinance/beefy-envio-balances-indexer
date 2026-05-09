import type { Erc4626Adapter, EvmBlock, EvmChainId, EvmOnEventContext, Token } from 'envio';
import type { Hex } from 'viem';
import { normalizeHex } from '../lib/hex';

export const erc4626AdapterId = ({ chainId, adapterAddress }: { chainId: EvmChainId; adapterAddress: Hex }) =>
    `${chainId}-${normalizeHex(adapterAddress)}`;

export const getErc4626Adapter = async (context: EvmOnEventContext, chainId: EvmChainId, adapterAddress: Hex) => {
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
    context: EvmOnEventContext;
    chainId: EvmChainId;
    adapterAddress: Hex;
    shareToken: Token;
    underlyingToken: Token;
    initializedBlock: EvmBlock;
}): Promise<Erc4626Adapter> => {
    const id = erc4626AdapterId({ chainId, adapterAddress });

    const adapter: Erc4626Adapter = {
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

export const isErc4626Adapter = async (context: EvmOnEventContext, chainId: EvmChainId, adapterAddress: Hex) => {
    const id = erc4626AdapterId({ chainId, adapterAddress });
    const adapter = await context.Erc4626Adapter.get(id);
    return adapter !== undefined;
};
