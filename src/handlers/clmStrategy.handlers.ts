import type { Hex } from 'viem';
import { getClmStrategyManager } from '../effects/clmStrategy.effects';
import { createClmStrategy, getClmManager, getClmStrategy } from '../entities/clmManager.entity';
import { type ChainId, toChainId } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import type { Block, ClmStrategy_t, HandlerContext } from '../lib/schema';
import { ClmStrategy_h } from '../lib/schema';

ClmStrategy_h.Initialized.handler(async ({ event, context }) => {
    context.log.debug('ClmStrategy.Initialized', { event });

    const chainId = toChainId(context.chain.id);
    const strategyAddress = event.srcAddress.toString().toLowerCase() as Hex;
    const initializedBlock = event.block;

    const strategy = await initializeClmStrategy({ context, chainId, strategyAddress, initializedBlock });
    if (!strategy) return;

    context.log.info('ClmStrategy initialized successfully', { strategyAddress });
});

const initializeClmStrategy = async ({
    context,
    chainId,
    strategyAddress,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    strategyAddress: Hex;
    initializedBlock: Block;
}): Promise<ClmStrategy_t | null> => {
    // Check if the strategy already exists
    const existingStrategy = await getClmStrategy(context, chainId, strategyAddress);
    if (existingStrategy) {
        return existingStrategy;
    }

    context.log.info('Initializing ClmStrategy', { strategyAddress, chainId });

    // Fetch manager address using effect
    const { managerAddress } = await context.effect(getClmStrategyManager, {
        strategyAddress,
        chainId,
    });

    if (managerAddress === ADDRESS_ZERO) {
        context.log.error('ClmStrategy manager address is zero', { strategyAddress, chainId });
        return null;
    }

    // Get the ClmManager entity
    const clmManager = await getClmManager(context, chainId, managerAddress);
    if (!clmManager) {
        context.log.warn('ClmManager not found for ClmStrategy', { strategyAddress, managerAddress, chainId });
        return null;
    }

    // Create CLM strategy entity
    return await createClmStrategy({
        context,
        chainId,
        strategyAddress,
        clmManager,
        initializedBlock,
    });
};
