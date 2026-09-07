import type { EvmBlock, EvmChainId, EvmOnEventContext, LstVault } from 'envio';
import { indexer } from 'envio';
import { getLstVaultTokens } from '../effects/lstVault.effects';
import { createLstVault, getLstVault } from '../entities/lstVault.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { type Bytes, toBytes, toHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'LstVault', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('LstVault.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const lstAddress = toBytes(event.srcAddress);
    const initializedBlock = event.block;

    const lst = await initializeLstVault({ context, chainId, lstAddress, initializedBlock });
    if (!lst) return;

    context.log.info('LstVault initialized successfully', { lstAddress });
});

indexer.onEvent(
    {
        contract: 'LstVault',
        event: 'Transfer',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('LstVault.Transfer', { event });

        const chainId = toChainId(context.chain.id);
        const lstAddress = toBytes(event.srcAddress);

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
            senderAddress: toBytes(event.params.from),
            receiverAddress: toBytes(event.params.to),
            rawTransferAmount: event.params.value,
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });
    }
);

const initializeLstVault = async ({
    context,
    chainId,
    lstAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    lstAddress: Bytes;
    initializedBlock: EvmBlock;
}): Promise<LstVault | null> => {
    // Check if the LST vault already exists
    const existingLst = await getLstVault(context, chainId, lstAddress);
    if (existingLst) {
        return existingLst;
    }

    context.log.info('Initializing LstVault', { lstAddress, chainId });

    // Fetch underlying tokens using effect
    const {
        shareTokenAddress: shareTokenAddressStr,
        underlyingTokenAddress: underlyingTokenAddressStr,
        blacklistStatus,
    } = await context.effect(getLstVaultTokens, {
        lstAddress: toHex(lstAddress),
        chainId,
    });
    const shareTokenAddress = toBytes(shareTokenAddressStr);
    const underlyingTokenAddress = toBytes(underlyingTokenAddressStr);

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

    if (!shareToken || !underlyingToken) {
        logBlacklistStatus(context.log, 'maybe_blacklisted', 'LstVault', {
            contractAddress: lstAddress,
            shareTokenAddress,
            underlyingTokenAddress,
            reason: 'invalid_token_metadata',
        });
        return null;
    }

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
