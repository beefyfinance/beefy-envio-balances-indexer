import { type Block_t, ClassicStrategy } from 'generated';
import type { ClassicVaultStrategy_t } from 'generated/src/db/Entities.gen';
import type { HandlerContext } from 'generated/src/Types';
import type { Hex } from 'viem';
import { getClassicStrategyVault } from '../effects/classicStrategy.effects';
import { createClassicVaultStrategy, getClassicVault, getClassicVaultStrategy } from '../entities/classicVault.entity';
import { type ChainId, toChainId } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';

ClassicStrategy.Initialized.handler(async ({ event, context }) => {
    const chainId = toChainId(context.chain.id);
    const strategyAddress = event.srcAddress.toString().toLowerCase() as Hex;
    const initializedBlock = event.block;

    const strategy = await initializeClassicStrategy({ context, chainId, strategyAddress, initializedBlock });
    if (!strategy) return;

    context.log.info('ClassicStrategy initialized successfully', { strategyAddress });
});

const initializeClassicStrategy = async ({
    context,
    chainId,
    strategyAddress,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    strategyAddress: Hex;
    initializedBlock: Block_t;
}): Promise<ClassicVaultStrategy_t | null> => {
    // Check if the strategy already exists
    const existingStrategy = await getClassicVaultStrategy(context, chainId, strategyAddress);
    if (existingStrategy) {
        return existingStrategy;
    }

    context.log.info('Initializing ClassicStrategy', { strategyAddress, chainId });

    // Fetch vault address using effect
    const { vaultAddress } = await context.effect(getClassicStrategyVault, {
        strategyAddress,
        chainId,
    });

    if (vaultAddress === ADDRESS_ZERO) {
        context.log.error('ClassicStrategy vault address is zero', { strategyAddress, chainId });
        return null;
    }

    // Get the ClassicVault entity
    const classicVault = await getClassicVault(context, chainId, vaultAddress);
    if (!classicVault) {
        context.log.warn('ClassicVault not found for ClassicStrategy', { strategyAddress, vaultAddress, chainId });
        return null;
    }

    // Create ClassicVaultStrategy entity
    return await createClassicVaultStrategy({
        context,
        chainId,
        strategyAddress,
        classicVault,
        initializedBlock,
    });
};
