import { Token } from 'generated';
import type { Hex } from 'viem';
import { getOrCreateToken } from '../entities/token.entity';
import { toChainId } from '../lib/chain';
import { handleTokenTransfer } from '../lib/token';

Token.Initialized.handler(async ({ event, context }) => {
    context.log.debug('Token.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const tokenAddress = event.srcAddress.toString().toLowerCase() as Hex;

    // Ensure the token exists in the database
    await getOrCreateToken({
        context,
        chainId,
        tokenAddress,
        virtual: false,
    });

    context.log.info('Token initialized', { tokenAddress, chainId });
});

Token.Transfer.handler(async ({ event, context }) => {
    context.log.debug('Token.Transfer', { event });

    const chainId = toChainId(context.chain.id);
    const tokenAddress = event.srcAddress.toString().toLowerCase() as Hex;

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
