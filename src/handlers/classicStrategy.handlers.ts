import { ClassicStrategy } from 'generated';
import type { Hex } from 'viem';
import { toChainId } from '../lib/chain';

ClassicStrategy.Initialized.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const strategyAddress = event.srcAddress.toString().toLowerCase() as Hex;
    const initializedBlock = BigInt(event.block.number);

    context.log.info('Initializing ClassicStrategy', { strategyAddress, chainId, initializedBlock });

    context.log.info('ClassicStrategy initialized successfully', { strategyAddress });
});
