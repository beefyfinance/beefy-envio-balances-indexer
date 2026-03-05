import type { Hex } from 'viem';
import type { ChainId } from '../lib/chain';
import type { Block, ClmManager_t, ClmStrategy_t, HandlerContext, Token_t } from '../lib/schema';

export const clmManagerId = ({ chainId, managerAddress }: { chainId: ChainId; managerAddress: Hex }) =>
    `${chainId}-${managerAddress.toLowerCase()}`;

export const getClmManager = async (context: HandlerContext, chainId: ChainId, managerAddress: Hex) => {
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
    context: HandlerContext;
    chainId: ChainId;
    managerAddress: Hex;
    shareToken: Token_t;
    underlyingToken0: Token_t;
    underlyingToken1: Token_t;
    initializedBlock: Block;
}): Promise<ClmManager_t> => {
    const id = clmManagerId({ chainId, managerAddress });

    const manager: ClmManager_t = {
        id,
        chainId,
        address: managerAddress,
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

export const clmStrategyId = ({ chainId, strategyAddress }: { chainId: ChainId; strategyAddress: Hex }) =>
    `${chainId}-${strategyAddress.toLowerCase()}`;

export const getClmStrategy = async (context: HandlerContext, chainId: ChainId, strategyAddress: Hex) => {
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
    context: HandlerContext;
    chainId: ChainId;
    strategyAddress: Hex;
    clmManager: ClmManager_t;
    initializedBlock: Block;
}): Promise<ClmStrategy_t> => {
    const id = clmStrategyId({ chainId, strategyAddress });

    const strategy: ClmStrategy_t = {
        id,
        chainId,
        address: strategyAddress,
        clmManager_id: clmManager.id,
        initializableStatus: 'INITIALIZED',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
    };

    context.ClmStrategy.set(strategy);
    return strategy;
};
