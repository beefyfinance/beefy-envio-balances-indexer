import type { EvmBlock, EvmChainId, EvmOnEventContext, LstVault, Token } from 'envio';
import type { Hex } from 'viem';
import { normalizeHex } from '../lib/hex';

export const LstVaultId = ({ chainId, lstAddress }: { chainId: EvmChainId; lstAddress: Hex }) =>
    `${chainId}-${normalizeHex(lstAddress)}`;

export const getLstVault = async (context: EvmOnEventContext, chainId: EvmChainId, lstAddress: Hex) => {
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
    context: EvmOnEventContext;
    chainId: EvmChainId;
    lstAddress: Hex;
    shareToken: Token;
    underlyingToken: Token;
    initializedBlock: EvmBlock;
}): Promise<LstVault> => {
    const id = LstVaultId({ chainId, lstAddress });

    const lst: LstVault = {
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
