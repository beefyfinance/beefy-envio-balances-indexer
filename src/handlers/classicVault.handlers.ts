import type { ClassicVault, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import { indexer } from 'envio';
import type { Hex } from 'viem';
import { getClassicVaultTokens } from '../effects/classicVault.effects';
import { createClassicVault, getClassicVault } from '../entities/classicVault.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { normalizeHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'ClassicVault', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('ClassicVault.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const vaultAddress = normalizeHex(event.srcAddress);
    const initializedBlock = event.block;

    const vault = await initializeClassicVault({ context, chainId, vaultAddress, initializedBlock });
    if (!vault) return;

    context.log.info('ClassicVault initialized successfully', { vaultAddress });
});

indexer.onEvent({ contract: 'ClassicVault', event: 'Transfer' }, async ({ event, context }) => {
    context.log.debug('ClassicVault.Transfer', { event });

    const chainId = toChainId(context.chain.id);
    const vaultAddress = normalizeHex(event.srcAddress);

    // Ensure that the vault is initialized first
    const vault = await initializeClassicVault({
        context,
        chainId,
        vaultAddress,
        initializedBlock: event.block,
    });
    if (!vault) return;

    const shareToken = await getTokenOrThrow({ context, id: vault.shareToken_id });

    await handleTokenTransfer({
        context,
        chainId,
        token: shareToken,
        senderAddress: normalizeHex(event.params.from),
        receiverAddress: normalizeHex(event.params.to),
        rawTransferAmount: event.params.value,
        event: {
            block: event.block,
            trxIndex: event.transaction.transactionIndex,
            logIndex: event.logIndex,
            trxHash: normalizeHex(event.transaction.hash),
        },
    });
});

const initializeClassicVault = async ({
    context,
    chainId,
    vaultAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    vaultAddress: Hex;
    initializedBlock: EvmBlock;
}): Promise<ClassicVault | null> => {
    // Check if the vault already exists
    const existingVault = await getClassicVault(context, chainId, vaultAddress);
    if (existingVault) {
        return existingVault;
    }

    context.log.info('Initializing ClassicVault', { vaultAddress, chainId });

    // Fetch underlying tokens using effect
    const { shareTokenAddress, underlyingTokenAddress, strategyAddress, blacklistStatus } = await context.effect(
        getClassicVaultTokens,
        {
            vaultAddress,
            chainId,
        }
    );

    if (blacklistStatus !== 'ok') {
        logBlacklistStatus(context.log, blacklistStatus, 'ClassicVault', {
            contractAddress: vaultAddress,
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

    // Create vault entity
    return await createClassicVault({
        context,
        chainId,
        vaultAddress,
        shareToken,
        underlyingToken,
        strategyAddress,
        initializedBlock,
    });
};
