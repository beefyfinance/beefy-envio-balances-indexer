/**
 * Helpers to register dynamic contract addresses in TestIndexer simulate arrays.
 *
 * Since Envio 3.3, simulate items whose srcAddress is not indexed (and not wildcard)
 * are rejected as "never reached a handler". Factory `contractRegister` events must
 * run first so later events on those proxies are routed.
 *
 * Do not put test-only addresses in config.yaml — register them here instead.
 */

import { encodeFunctionData } from 'viem';
import { classicVaultFactoryAbi } from '../../effects/abis/beefy/classic/ClassicVaultFactory';

type Block = { number: number; timestamp: number };

/** ClassicVaultFactory needs cloneVault calldata to classify the proxy as a vault. */
export const registerClassicVault = ({
    factory,
    proxy,
    block,
    logIndex = 0,
    trxHash = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
}: {
    factory: `0x${string}`;
    proxy: `0x${string}`;
    block: Block;
    logIndex?: number;
    trxHash?: `0x${string}`;
}) => ({
    contract: 'ClassicVaultFactory' as const,
    event: 'VaultOrStrategyCreated' as const,
    block,
    logIndex,
    srcAddress: factory,
    transaction: {
        hash: trxHash,
        input: encodeFunctionData({
            abi: classicVaultFactoryAbi,
            functionName: 'cloneVault',
            args: [],
        }),
    },
    params: { proxy },
});

export const registerClmManager = ({
    factory,
    proxy,
    block,
    logIndex = 0,
}: {
    factory: `0x${string}`;
    proxy: `0x${string}`;
    block: Block;
    logIndex?: number;
}) => ({
    contract: 'ClmManagerFactory' as const,
    event: 'ClmManagerCreated' as const,
    block,
    logIndex,
    srcAddress: factory,
    params: { proxy },
});

export const registerClmStrategy = ({
    factory,
    proxy,
    block,
    logIndex = 0,
}: {
    factory: `0x${string}`;
    proxy: `0x${string}`;
    block: Block;
    logIndex?: number;
}) => ({
    contract: 'ClmStrategyFactory' as const,
    event: 'ClmStrategyCreated' as const,
    block,
    logIndex,
    srcAddress: factory,
    params: { proxy },
});

export const registerClassicStrategy = ({
    factory,
    proxy,
    block,
    logIndex = 0,
}: {
    factory: `0x${string}`;
    proxy: `0x${string}`;
    block: Block;
    logIndex?: number;
}) => ({
    contract: 'ClassicStrategyFactory' as const,
    event: 'StrategyCreated' as const,
    block,
    logIndex,
    srcAddress: factory,
    params: { proxy },
});

export const registerErc4626Adapter = ({
    factory,
    proxy,
    block,
    logIndex = 0,
}: {
    factory: `0x${string}`;
    proxy: `0x${string}`;
    block: Block;
    logIndex?: number;
}) => ({
    contract: 'Erc4626AdapterFactory' as const,
    event: 'Erc4626AdapterCreated' as const,
    block,
    logIndex,
    srcAddress: factory,
    params: { proxy },
});

export const registerClassicBoost = ({
    factory,
    proxy,
    block,
    logIndex = 0,
}: {
    factory: `0x${string}`;
    proxy: `0x${string}`;
    block: Block;
    logIndex?: number;
}) => ({
    contract: 'ClassicBoostFactory' as const,
    event: 'BoostCreated' as const,
    block,
    logIndex,
    srcAddress: factory,
    params: { proxy },
});

export const registerRewardPool = ({
    factory,
    proxy,
    block,
    logIndex = 0,
}: {
    factory: `0x${string}`;
    proxy: `0x${string}`;
    block: Block;
    logIndex?: number;
}) => ({
    contract: 'RewardPoolFactory' as const,
    event: 'RewardPoolCreated' as const,
    block,
    logIndex,
    srcAddress: factory,
    params: { proxy },
});

/** Factories with non-empty addresses in config.yaml for chains used by tests */
export const FACTORIES = {
    8453: {
        ClmManagerFactory: '0x7bc78990ac1ef0754cfde935b2d84e9acf13ed29' as const,
        ClmStrategyFactory: '0x9476284d81121613da5df5c72f50853a455448f1' as const,
        Erc4626AdapterFactory: '0x917447f8f52e7db26ce7f52be2f3fcb4d4d00832' as const,
        RewardPoolFactory: '0x13f518aa15ca3296e51ceafb44a8d86660e97b3a' as const,
        ClassicVaultFactory: '0xbc4a342b0c057501e081484a2d24e576e854f823' as const,
    },
    56: {
        ClassicStrategyFactory: '0x8b93779aa8613d9542bcd5e153d536ba5b9039f2' as const,
        ClassicVaultFactory: '0xe596ec590de52c09c8d1c7a1294b32f957a7c94e' as const,
    },
    1: {
        ClassicBoostFactory: '0x6f168346aed66f37cd972191ec4c3db11b8e5ecd' as const,
        RewardPoolFactory: '0xf8a577a29c85bb379ef9cef2eae5ab11c3965c1b' as const,
    },
    137: {
        ClassicStrategyFactory: '0x5f04211f4604bb39f3ae4e58c3652f7b46022058' as const,
    },
    143: {
        ClassicVaultFactory: '0x9818df1bdce8d0e79b982e2c3a93ac821b3c17e0' as const,
    },
} as const;
