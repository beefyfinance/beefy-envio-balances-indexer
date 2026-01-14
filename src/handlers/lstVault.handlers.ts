import { type Block_t, LstVault } from 'generated';
import type { LstVault_t } from 'generated/src/db/Entities.gen';
import type { HandlerContext } from 'generated/src/Types';
import type { Hex } from 'viem';
import { getLstVaultTokens } from '../effects/lstVault.effects';
import { createLstVault, getLstVault } from '../entities/lstVault.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { type ChainId, toChainId } from '../lib/chain';
import { handleTokenTransfer } from '../lib/token';

LstVault.Initialized.handler(async ({ event, context }) => {
    context.log.debug('LstVault.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const lstAddress = event.srcAddress.toString().toLowerCase() as Hex;
    const initializedBlock = event.block;

    const lst = await initializeLstVault({ context, chainId, lstAddress, initializedBlock });
    if (!lst) return;

    context.log.info('LstVault initialized successfully', { lstAddress });
});

LstVault.Transfer.handler(async ({ event, context }) => {
    context.log.debug('LstVault.Transfer', { event });

    const chainId = toChainId(context.chain.id);
    const lstAddress = event.srcAddress.toString().toLowerCase() as Hex;

    // Ensure that the LST vault is initialized first
    const lst = await initializeLstVault({
        context,
        chainId,
        lstAddress,
        initializedBlock: event.block,
    });
    if (!lst) return;

    const shareToken = await getTokenOrThrow({ context, id: lst.shareToken_id });

    await handleTokenTransfer({
        context,
        chainId,
        token: shareToken,
        senderAddress: event.params.from.toString().toLowerCase() as Hex,
        receiverAddress: event.params.to.toString().toLowerCase() as Hex,
        rawTransferAmount: event.params.value,
        event: {
            block: event.block,
            logIndex: event.logIndex,
            trxHash: event.transaction.hash.toString().toLowerCase() as Hex,
        },
    });
});

const initializeLstVault = async ({
    context,
    chainId,
    lstAddress,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    lstAddress: Hex;
    initializedBlock: Block_t;
}): Promise<LstVault_t | null> => {
    // Check if the LST vault already exists
    const existingLst = await getLstVault(context, chainId, lstAddress);
    if (existingLst) {
        return existingLst;
    }

    context.log.info('Initializing LstVault', { lstAddress, chainId });

    // Fetch underlying tokens using effect
    const { shareTokenAddress, underlyingTokenAddress, blacklistStatus } = await context.effect(getLstVaultTokens, {
        lstAddress,
        chainId,
    });

    if (blacklistStatus !== 'ok') {
        logBlacklistStatus(context.log, blacklistStatus, 'LstVault', {
            contractAddress: lstAddress,
            shareTokenAddress,
            underlyingTokenAddress,
        });
        return null;
    }

    // Create tokens
    const [shareToken, underlyingToken] = await Promise.all([
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: shareTokenAddress,
            virtual: false,
        }),
        getOrCreateToken({
            context,
            chainId,
            tokenAddress: underlyingTokenAddress,
            virtual: false,
        }),
    ]);

    // Create LST vault entity
    return await createLstVault({
        context,
        chainId,
        lstAddress,
        shareToken,
        underlyingToken,
        initializedBlock,
    });
};
