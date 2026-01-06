import { type Block_t, ClassicVault } from 'generated';
import type { ClassicVault_t } from 'generated/src/db/Entities.gen';
import type { HandlerContext } from 'generated/src/Types';
import type { Hex } from 'viem';
import { getClassicVaultTokens } from '../effects/classicVault.effects';
import { createClassicVault, getClassicVault } from '../entities/classicVault.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { type ChainId, toChainId } from '../lib/chain';
import { handleTokenTransfer } from '../lib/token';

ClassicVault.Initialized.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const vaultAddress = event.srcAddress.toString().toLowerCase() as Hex;
    const initializedBlock = event.block;

    const vault = await initializeClassicVault({ context, chainId, vaultAddress, initializedBlock });
    if (!vault) return;

    context.log.info('ClassicVault initialized successfully', { vaultAddress });
});

ClassicVault.Transfer.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const vaultAddress = event.srcAddress.toString().toLowerCase() as Hex;

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

const initializeClassicVault = async ({
    context,
    chainId,
    vaultAddress,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    vaultAddress: Hex;
    initializedBlock: Block_t;
}): Promise<ClassicVault_t | null> => {
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
