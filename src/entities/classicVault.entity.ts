import type { ClassicVault, ClassicVaultStrategy, EvmBlock, EvmChainId, EvmOnEventContext, Token } from 'envio';
import type { Hex } from 'viem';
import { normalizeHex } from '../lib/hex';

export const classicVaultId = ({ chainId, vaultAddress }: { chainId: EvmChainId; vaultAddress: Hex }) =>
    `${chainId}-${normalizeHex(vaultAddress)}`;

export const getClassicVault = async (context: EvmOnEventContext, chainId: EvmChainId, vaultAddress: Hex) => {
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
    context: EvmOnEventContext;
    chainId: EvmChainId;
    vaultAddress: Hex;
    shareToken: Token;
    underlyingToken: Token;
    strategyAddress: Hex;
    initializedBlock: EvmBlock;
}): Promise<ClassicVault> => {
    const id = classicVaultId({ chainId, vaultAddress });

    const vault: ClassicVault = {
        id,
        address: vaultAddress,
        shareToken_id: shareToken.id,
        underlyingToken_id: underlyingToken.id,
        classic_id: undefined,
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

export const classicVaultStrategyId = ({ chainId, strategyAddress }: { chainId: EvmChainId; strategyAddress: Hex }) =>
    `${chainId}-${normalizeHex(strategyAddress)}`;

export const getClassicVaultStrategy = async (
    context: EvmOnEventContext,
    chainId: EvmChainId,
    strategyAddress: Hex
) => {
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
    context: EvmOnEventContext;
    chainId: EvmChainId;
    strategyAddress: Hex;
    classicVault: ClassicVault;
    initializedBlock: EvmBlock;
}): Promise<ClassicVaultStrategy> => {
    const id = classicVaultStrategyId({ chainId, strategyAddress });

    const strategy: ClassicVaultStrategy = {
        id,
        address: strategyAddress,
        classicVault_id: classicVault.id,
        initializableStatus: 'INITIALIZED',
        pausableStatus: 'RUNNING',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.ClassicVaultStrategy.set(strategy);
    return strategy;
};

export const isClassicVaultStrategy = async (context: EvmOnEventContext, chainId: EvmChainId, strategyAddress: Hex) => {
    const id = classicVaultStrategyId({ chainId, strategyAddress });
    const strategy = await context.ClassicVaultStrategy.get(id);
    return strategy !== undefined;
};
