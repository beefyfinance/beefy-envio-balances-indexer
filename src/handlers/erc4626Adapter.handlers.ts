import type { Erc4626Adapter, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import { indexer } from 'envio';
import type { Hex } from 'viem';
import { getErc4626AdapterTokens } from '../effects/erc4626Adapter.effects';
import { createErc4626Adapter, getErc4626Adapter } from '../entities/classicErc4626Adapter.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { normalizeHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'Erc4626Adapter', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('Erc4626Adapter.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const adapterAddress = normalizeHex(event.srcAddress);
    const initializedBlock = event.block;

    const adapter = await initializeErc4626Adapter({ context, chainId, adapterAddress, initializedBlock });
    if (!adapter) return;

    context.log.info('Erc4626Adapter initialized successfully', { adapterAddress });
});

indexer.onEvent({ contract: 'Erc4626Adapter', event: 'Transfer' }, async ({ event, context }) => {
    context.log.debug('Erc4626Adapter.Transfer', { event });

    const chainId = toChainId(context.chain.id);
    const adapterAddress = normalizeHex(event.srcAddress);

    // Ensure that the adapter is initialized first
    const adapter = await initializeErc4626Adapter({
        context,
        chainId,
        adapterAddress,
        initializedBlock: event.block,
    });
    if (!adapter) return;

    const shareToken = await getTokenOrThrow({ context, id: adapter.shareToken_id });

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

const initializeErc4626Adapter = async ({
    context,
    chainId,
    adapterAddress,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    adapterAddress: Hex;
    initializedBlock: EvmBlock;
}): Promise<Erc4626Adapter | null> => {
    // Check if the adapter already exists
    const existingAdapter = await getErc4626Adapter(context, chainId, adapterAddress);
    if (existingAdapter) {
        return existingAdapter;
    }

    context.log.info('Initializing Erc4626Adapter', { adapterAddress, chainId });

    // Fetch underlying tokens using effect
    const { shareTokenAddress, underlyingTokenAddress, blacklistStatus } = await context.effect(
        getErc4626AdapterTokens,
        {
            adapterAddress,
            chainId,
        }
    );

    if (blacklistStatus !== 'ok') {
        logBlacklistStatus(context.log, blacklistStatus, 'Erc4626Adapter', {
            contractAddress: adapterAddress,
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

    // Create ERC4626 adapter entity
    return await createErc4626Adapter({
        context,
        chainId,
        adapterAddress,
        shareToken,
        underlyingToken,
        initializedBlock,
    });
};
