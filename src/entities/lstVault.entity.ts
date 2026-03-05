import type { Hex } from 'viem';
import type { ChainId } from '../lib/chain';
import type { Block, HandlerContext, LstVault_t, Token_t } from '../lib/schema';

export const LstVaultId = ({ chainId, lstAddress }: { chainId: ChainId; lstAddress: Hex }) =>
    `${chainId}-${lstAddress.toLowerCase()}`;

export const getLstVault = async (context: HandlerContext, chainId: ChainId, lstAddress: Hex) => {
    const id = LstVaultId({ chainId, lstAddress });
    const lst = await context.LstVault.get(id);
    return lst;
};

export const createLstVault = async ({
    context,
    chainId,
    lstAddress,
    shareToken,
    underlyingToken,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    lstAddress: Hex;
    shareToken: Token_t;
    underlyingToken: Token_t;
    initializedBlock: Block;
}): Promise<LstVault_t> => {
    const id = LstVaultId({ chainId, lstAddress });

    const lst: LstVault_t = {
        id,
        chainId,
        address: lstAddress,
        shareToken_id: shareToken.id,
        underlyingToken_id: underlyingToken.id,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.LstVault.set(lst);
    return lst;
};
