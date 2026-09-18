import { indexer } from 'envio';
import { applySetOracle, applySetSlippage, applySetSwapInfo, getOrCreateSwapper } from '../entities/swapper.entity';
import { getOrCreateToken } from '../entities/token.entity';
import { toChainId } from '../lib/chain';
import { toBytes } from '../lib/hex';

const eventFields = { transaction: ['hash', 'transactionIndex'], block: ['timestamp'] } as const;

indexer.onEvent(
    {
        contract: 'BeefySwapper',
        event: 'SetSwapInfo',
        fields: eventFields,
    },
    async ({ event, context }) => {
        context.log.debug('BeefySwapper.SetSwapInfo', { event });

        const chainId = toChainId(context.chain.id);
        const swapperAddress = toBytes(event.srcAddress);
        const [swapper, fromToken, toToken] = await Promise.all([
            getOrCreateSwapper({ context, chainId, address: swapperAddress }),
            getOrCreateToken({
                context,
                chainId,
                tokenAddress: toBytes(event.params.fromToken),
                virtual: false,
            }),
            getOrCreateToken({
                context,
                chainId,
                tokenAddress: toBytes(event.params.toToken),
                virtual: false,
            }),
        ]);
        if (!fromToken || !toToken) {
            context.log.error('BeefySwapper.SetSwapInfo skipped, token metadata unavailable', {
                fromToken: event.params.fromToken,
                toToken: event.params.toToken,
            });
            return;
        }

        await applySetSwapInfo({
            context,
            chainId,
            swapper,
            fromToken,
            toToken,
            router: toBytes(event.params.swapInfo.router),
            data: toBytes(event.params.swapInfo.data),
            amountIndex: event.params.swapInfo.amountIndex,
            minIndex: event.params.swapInfo.minIndex,
            minAmountSign: Number(event.params.swapInfo.minAmountSign),
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });
    }
);

indexer.onEvent(
    {
        contract: 'BeefySwapper',
        event: 'SetOracle',
        fields: eventFields,
    },
    async ({ event, context }) => {
        context.log.debug('BeefySwapper.SetOracle', { event });

        const chainId = toChainId(context.chain.id);
        await applySetOracle({
            context,
            chainId,
            swapperAddress: toBytes(event.srcAddress),
            oracle: toBytes(event.params.oracle),
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });
    }
);

indexer.onEvent(
    {
        contract: 'BeefySwapper',
        event: 'SetSlippage',
        fields: eventFields,
    },
    async ({ event, context }) => {
        context.log.debug('BeefySwapper.SetSlippage', { event });

        const chainId = toChainId(context.chain.id);
        await applySetSlippage({
            context,
            chainId,
            swapperAddress: toBytes(event.srcAddress),
            slippage: event.params.slippage,
            event: {
                block: event.block,
                trxIndex: event.transaction.transactionIndex,
                logIndex: event.logIndex,
                trxHash: toBytes(event.transaction.hash),
            },
        });
    }
);
