import type { Block_t, handlerContext as HandlerContext } from 'generated';
import type { ClassicVault_t, ClassicVaultStrategy_t, Token_t } from 'generated/src/db/Entities.gen';
import type { Hex } from 'viem';
import type { ChainId } from '../lib/chain';

export const classicVaultId = ({ chainId, vaultAddress }: { chainId: ChainId; vaultAddress: Hex }) =>
    `${chainId}-${vaultAddress.toLowerCase()}`;

export const getClassicVault = async (context: HandlerContext, chainId: ChainId, vaultAddress: Hex) => {
    const id = classicVaultId({ chainId, vaultAddress });
    const vault = await context.ClassicVault.get(id);
    return vault;
};

export const createClassicVault = async ({
    context,
    chainId,
    vaultAddress,
    shareToken,
    underlyingToken,
    strategyAddress,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    vaultAddress: Hex;
    shareToken: Token_t;
    underlyingToken: Token_t;
    strategyAddress: Hex;
    initializedBlock: Block_t;
}): Promise<ClassicVault_t> => {
    const id = classicVaultId({ chainId, vaultAddress });

    const vault: ClassicVault_t = {
        id,
        chainId,
        address: vaultAddress,
        shareToken_id: shareToken.id,
        underlyingToken_id: underlyingToken.id,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.ClassicVault.set(vault);

    await createClassicVaultStrategy({
        context,
        chainId,
        strategyAddress: strategyAddress,
        classicVault: vault,
        initializedBlock,
    });

    return vault;
};

export const classicVaultStrategyId = ({ chainId, strategyAddress }: { chainId: ChainId; strategyAddress: Hex }) =>
    `${chainId}-${strategyAddress.toLowerCase()}`;

export const getClassicVaultStrategy = async (context: HandlerContext, chainId: ChainId, strategyAddress: Hex) => {
    const id = classicVaultStrategyId({ chainId, strategyAddress });
    const strategy = await context.ClassicVaultStrategy.get(id);
    return strategy;
};

export const createClassicVaultStrategy = async ({
    context,
    chainId,
    strategyAddress,
    classicVault,
    initializedBlock,
}: {
    context: HandlerContext;
    chainId: ChainId;
    strategyAddress: Hex;
    classicVault: ClassicVault_t;
    initializedBlock: Block_t;
}): Promise<ClassicVaultStrategy_t> => {
    const id = classicVaultStrategyId({ chainId, strategyAddress });

    const strategy: ClassicVaultStrategy_t = {
        id,
        chainId,
        address: strategyAddress,
        classicVault_id: classicVault.id,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.ClassicVaultStrategy.set(strategy);
    return strategy;
};

export const isClassicVaultStrategy = async (context: HandlerContext, chainId: ChainId, strategyAddress: Hex) => {
    const id = classicVaultStrategyId({ chainId, strategyAddress });
    const strategy = await context.ClassicVaultStrategy.get(id);
    return strategy !== undefined;
};
