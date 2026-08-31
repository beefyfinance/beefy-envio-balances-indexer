import type { ClassicErc4626Adapter, EvmBlock, EvmChainId, EvmOnEventContext } from 'envio';
import { indexer } from 'envio';
import type { Hex } from 'viem';
import { fetchClassicState, parseFetchedClassicState } from '../effects/classic.effects';
import { getErc4626AdapterTokens } from '../effects/erc4626Adapter.effects';
import { getClassic, linkClassicErc4626Adapter } from '../entities/classic.entity';
import { createErc4626Adapter, getErc4626Adapter } from '../entities/classicErc4626Adapter.entity';
import { getOrCreateToken, getTokenOrThrow } from '../entities/token.entity';
import { logBlacklistStatus } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { isClassicVaultStakedToken, tryLinkClassicErc4626Adapter } from '../lib/classic/init';
import { handleClassicErc4626AdapterTransfer } from '../lib/classic/position';
import { buildClassicFetchInput, loadClassicTokens } from '../lib/classic/tokens';
import { interpretAsDecimal } from '../lib/decimal';
import { normalizeHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'Erc4626Adapter', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('Erc4626Adapter.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const adapterAddress = normalizeHex(event.srcAddress);
    const initializedBlock = event.block;

    const adapter = await initializeErc4626Adapter({ context, chainId, adapterAddress, initializedBlock });
    if (!adapter) return;

    const underlyingToken = await getTokenOrThrow({ context, id: adapter.underlyingToken_id });
    const isClassicAdapter = await isClassicVaultStakedToken({
        context,
        chainId,
        stakedTokenAddress: normalizeHex(underlyingToken.address),
    });
    if (!isClassicAdapter) return;

    const classic = await getClassic(context, chainId, normalizeHex(underlyingToken.address));
    if (!classic) return;

    const shareToken = await getTokenOrThrow({ context, id: adapter.shareToken_id });
    await linkClassicErc4626Adapter({ context, classic, adapterShareToken: shareToken });
    context.ClassicErc4626Adapter.set({ ...adapter, classic_id: classic.id });

    context.log.info('Erc4626Adapter initialized successfully', { adapterAddress });
});

indexer.onEvent(
    {
        contract: 'Erc4626Adapter',
        event: 'Transfer',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('Erc4626Adapter.Transfer', { event });

        const chainId = toChainId(context.chain.id);
        const adapterAddress = normalizeHex(event.srcAddress);

        let adapter = await initializeErc4626Adapter({
            context,
            chainId,
            adapterAddress,
            initializedBlock: event.block,
        });
        if (!adapter) return;
        adapter = await tryLinkClassicErc4626Adapter({ context, chainId, adapter });

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

        if (!adapter.classic_id) return;

        const classic = await context.Classic.get(adapter.classic_id);
        if (!classic || classic.initializableStatus !== 'INITIALIZED' || !classic.classicVaultStrategy_id) return;

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

        await handleClassicErc4626AdapterTransfer({
            context,
            chainId,
            classic,
            adapter,
            fromAddress: normalizeHex(event.params.from),
            toAddress: normalizeHex(event.params.to),
            transferAmount: interpretAsDecimal(event.params.value, shareToken.decimals),
            state,
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: normalizeHex(event.transaction.hash),
            },
        });
    }
);

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
}): Promise<ClassicErc4626Adapter | null> => {
    const existingAdapter = await getErc4626Adapter(context, chainId, adapterAddress);
    if (existingAdapter) {
        return existingAdapter;
    }

    context.log.info('Initializing Erc4626Adapter', { adapterAddress, chainId });

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
        logBlacklistStatus(context.log, 'maybe_blacklisted', 'Erc4626Adapter', {
            contractAddress: adapterAddress,
            shareTokenAddress,
            underlyingTokenAddress,
            reason: 'invalid_token_metadata',
        });
        return null;
    }

    return await createErc4626Adapter({
        context,
        chainId,
        adapterAddress,
        shareToken,
        underlyingToken,
        initializedBlock,
    });
};
