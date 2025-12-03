import { ClmStrategy } from 'generated';
import type { Hex } from 'viem';
import { toChainId } from '../lib/chain';

ClmStrategy.Initialized.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const strategyAddress = event.srcAddress.toString().toLowerCase() as Hex;

    context.log.info('Initializing ClmStrategy', { strategyAddress, chainId });

    context.log.info('ClmStrategy initialized successfully', { strategyAddress });
});
