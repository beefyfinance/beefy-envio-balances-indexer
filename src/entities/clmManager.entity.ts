import type { ClmManager, ClmStrategy, EvmBlock, EvmChainId, EvmOnEventContext, Token } from 'envio';
import type { Hex } from 'viem';
import { normalizeHex } from '../lib/hex';

export const clmManagerId = ({ chainId, managerAddress }: { chainId: EvmChainId; managerAddress: Hex }) =>
    `${chainId}-${normalizeHex(managerAddress)}`;

export const getClmManager = async (context: EvmOnEventContext, chainId: EvmChainId, managerAddress: Hex) => {
    const id = clmManagerId({ chainId, managerAddress });
    const manager = await context.ClmManager.get(id);
    return manager;
};

export const createClmManager = async ({
    context,
    chainId,
    managerAddress,
    shareToken,
    underlyingToken0,
    underlyingToken1,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    managerAddress: Hex;
    shareToken: Token;
    underlyingToken0: Token;
    underlyingToken1: Token;
    initializedBlock: EvmBlock;
}): Promise<ClmManager> => {
    const id = clmManagerId({ chainId, managerAddress });

    const manager: ClmManager = {
        id,
        chainId,
        address: managerAddress,
        clm_id: undefined,
        shareToken_id: shareToken.id,
        underlyingToken0_id: underlyingToken0.id,
        underlyingToken1_id: underlyingToken1.id,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.ClmManager.set(manager);
    return manager;
};

export const clmStrategyId = ({ chainId, strategyAddress }: { chainId: EvmChainId; strategyAddress: Hex }) =>
    `${chainId}-${normalizeHex(strategyAddress)}`;

export const getClmStrategy = async (context: EvmOnEventContext, chainId: EvmChainId, strategyAddress: Hex) => {
    const id = clmStrategyId({ chainId, strategyAddress });
    const strategy = await context.ClmStrategy.get(id);
    return strategy;
};

export const createClmStrategy = async ({
    context,
    chainId,
    strategyAddress,
    clmManager,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    strategyAddress: Hex;
    clmManager: ClmManager;
    initializedBlock: EvmBlock;
}): Promise<ClmStrategy> => {
    const id = clmStrategyId({ chainId, strategyAddress });

    const strategy: ClmStrategy = {
        id,
        chainId,
        address: strategyAddress,
        clmManager_id: clmManager.id,
        initializableStatus: 'INITIALIZED',
        pausableStatus: 'RUNNING',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.ClmStrategy.set(strategy);
    return strategy;
};
