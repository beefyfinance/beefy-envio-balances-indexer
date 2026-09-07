import { indexer } from 'envio';
import { getOrCreateToken } from '../entities/token.entity';
import { toChainId } from '../lib/chain';
import { toBytes } from '../lib/hex';
import { handleTokenTransfer } from '../lib/token';

indexer.onEvent({ contract: 'Token', event: 'Initialized' }, async ({ event, context }) => {
    context.log.debug('Token.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const tokenAddress = toBytes(event.srcAddress);

    const token = await getOrCreateToken({
        context,
        chainId,
        tokenAddress,
        virtual: false,
    });
    if (!token) return;

    context.log.info('Token initialized', { tokenAddress, chainId });
});

indexer.onEvent(
    {
        contract: 'Token',
        event: 'Transfer',
        fields: { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] },
    },
    async ({ event, context }) => {
        context.log.debug('Token.Transfer', { event });

        const chainId = toChainId(context.chain.id);
        const tokenAddress = toBytes(event.srcAddress);

        const token = await getOrCreateToken({
            context,
            chainId,
            tokenAddress,
            virtual: false,
        });
        if (!token) return;

        await handleTokenTransfer({
            context,
            chainId,
            token,
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
