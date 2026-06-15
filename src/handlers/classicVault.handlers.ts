import type { ClassicVault, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import { indexer } from 'envio';
import type { Hex } from 'viem';
import './clock.handlers';
import { fetchClassicState, parseFetchedClassicState } from '../effects/classic.effects';
import { getClassicVaultTokens } from '../effects/classicVault.effects';
import { getClassic } from '../entities/classic.entity';
import { createClassicVault, getClassicVault } from '../entities/classicVault.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { ensureClassicAggregate, maybeFinalizeClassic, maybeLinkClassicStrategy } from '../lib/classic/init';
import { handleClassicVaultTransfer } from '../lib/classic/position';
import { buildClassicFetchInput, loadClassicTokens } from '../lib/classic/tokens';
import { interpretAsDecimal } from '../lib/decimal';
import { normalizeHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'ClassicVault', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('ClassicVault.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const vaultAddress = normalizeHex(event.srcAddress);
    const initializedBlock = event.block;

    const vault = await initializeClassicVault({ context, chainId, vaultAddress, initializedBlock });
    if (!vault) return;

    let classic = await ensureClassicAggregate({ context, chainId, classicVault: vault, initializedBlock });
    const strategies = await context.ClassicVaultStrategy.getWhere({ classicVault_id: { _eq: vault.id } });
    const strategy = strategies[0];
    if (strategy) {
        classic = await maybeLinkClassicStrategy({ context, chainId, classic, strategy });
        await maybeFinalizeClassic({
            context,
            chainId,
            classic,
            strategy,
            timestamp: event.block.timestamp,
            blockNumber: event.block.number,
        });
    }

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

    const classic = await getClassic(context, chainId, vaultAddress);
    if (!classic || classic.initializableStatus !== 'INITIALIZED' || !classic.classicVaultStrategy_id) {
        context.log.warn('ClassicVault not initialized or has no strategy', { vaultAddress, chainId });
        return;
    }

    const tokenContext = await loadClassicTokens({ context, classic });
    const fetchInput = await buildClassicFetchInput({
        context,
        chainId,
        classic,
        tokens: tokenContext,
        blockNumber: event.block.number,
    });
    const rawState = await context.effect(fetchClassicState, fetchInput);
    const state = parseFetchedClassicState(rawState, tokenContext);

    await handleClassicVaultTransfer({
        context,
        chainId,
        classic,
        fromAddress: normalizeHex(event.params.from),
        toAddress: normalizeHex(event.params.to),
        transferAmount: interpretAsDecimal(event.params.value, tokenContext.vaultToken.decimals),
        state,
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

    if (!shareToken || !underlyingToken) {
        logBlacklistStatus(context.log, 'maybe_blacklisted', 'ClassicVault', {
            contractAddress: vaultAddress,
            shareTokenAddress,
            underlyingTokenAddress,
            reason: 'invalid_token_metadata',
        });
        return null;
    }

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
