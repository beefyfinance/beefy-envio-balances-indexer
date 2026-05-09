import { indexer } from 'envio';
import { getOrCreateToken } from '../entities/token.entity';
import { toChainId } from '../lib/chain';
import { normalizeHex } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'Token', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('Token.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const tokenAddress = normalizeHex(event.srcAddress);

    // Ensure the token exists in the database
    await getOrCreateToken({
        context,
        chainId,
        tokenAddress,
        virtual: false,
    });

    context.log.info('Token initialized', { tokenAddress, chainId });
});

indexer.onEvent({ contract: 'Token', event: 'Transfer' }, async ({ event, context }) => {
    context.log.debug('Token.Transfer', { event });

    const chainId = toChainId(context.chain.id);
    const tokenAddress = normalizeHex(event.srcAddress);

    // Ensure the token exists first
    const token = await getOrCreateToken({
        context,
        chainId,
        tokenAddress,
        virtual: false,
    });

    await handleTokenTransfer({
        context,
        chainId,
        token,
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
