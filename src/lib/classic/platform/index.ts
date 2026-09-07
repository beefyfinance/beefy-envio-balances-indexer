import type { PublicClient } from 'viem';
import { type Bytes, toBytes, toHex } from '../../hex';
import type { TokenBalance } from './common';

const blockTag = (blockNumber?: number) => (blockNumber !== undefined ? { blockNumber: BigInt(blockNumber) } : {});

const totalSupplyAbi = [
    { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

const balanceAbi = [
    { inputs: [], name: 'balance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

const aTokenAbi = [
    { inputs: [], name: 'aToken', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
] as const;

export const isAaveVault = async (client: PublicClient, strategyAddress: Bytes): Promise<boolean> => {
    const [result] = await client.multicall({
        allowFailure: true,
        contracts: [{ address: toHex(strategyAddress), abi: aTokenAbi, functionName: 'aToken' }],
    });
    return result.status === 'success';
};

export const getVaultTokenBreakdownAave = async ({
    client,
    vaultAddress,
    underlyingTokenAddress,
    blockNumber,
}: {
    client: PublicClient;
    vaultAddress: Bytes;
    underlyingTokenAddress: Bytes;
    blockNumber?: number;
}): Promise<TokenBalance[]> => {
    const [balanceResult] = await client.multicall({
        allowFailure: true,
        ...blockTag(blockNumber),
        contracts: [{ address: toHex(vaultAddress), abi: balanceAbi, functionName: 'balance' }],
    });
    if (balanceResult.status === 'failure') {
        return [];
    }
    return [{ tokenAddress: underlyingTokenAddress, rawBalance: balanceResult.result }];
};

const coinsAbi = [
    {
        inputs: [{ name: 'index', type: 'uint256' }],
        name: 'coins',
        outputs: [{ type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;

const balancesAbi = [
    {
        inputs: [{ name: 'index', type: 'uint256' }],
        name: 'balances',
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;

export const isCurveVault = async ({
    client,
    vaultAddress,
    underlyingTokenAddress,
}: {
    client: PublicClient;
    vaultAddress: Bytes;
    underlyingTokenAddress: Bytes;
}): Promise<boolean> => {
    const breakdown = await getVaultTokenBreakdownCurve({ client, vaultAddress, underlyingTokenAddress });
    return breakdown.length > 0;
};

export const getVaultTokenBreakdownCurve = async ({
    client,
    vaultAddress,
    underlyingTokenAddress,
    blockNumber,
}: {
    client: PublicClient;
    vaultAddress: Bytes;
    underlyingTokenAddress: Bytes;
    blockNumber?: number;
}): Promise<TokenBalance[]> => {
    const vaultAddressStr = toHex(vaultAddress);
    const underlyingTokenAddressStr = toHex(underlyingTokenAddress);
    const [wantTotalBalanceResult, totalSupplyResult, coin0Result, coin1Result] = await client.multicall({
        allowFailure: true,
        ...blockTag(blockNumber),
        contracts: [
            { address: vaultAddressStr, abi: balanceAbi, functionName: 'balance' },
            { address: underlyingTokenAddressStr, abi: totalSupplyAbi, functionName: 'totalSupply' },
            { address: underlyingTokenAddressStr, abi: coinsAbi, functionName: 'coins', args: [0n] },
            { address: underlyingTokenAddressStr, abi: coinsAbi, functionName: 'coins', args: [1n] },
        ],
    });

    if (
        wantTotalBalanceResult.status === 'failure' ||
        totalSupplyResult.status === 'failure' ||
        coin0Result.status === 'failure' ||
        coin1Result.status === 'failure'
    ) {
        return [];
    }

    const wantTotalBalance = wantTotalBalanceResult.result;
    const totalSupply = totalSupplyResult.result;
    if (totalSupply === 0n) {
        return [];
    }

    const coins: Bytes[] = [toBytes(coin0Result.result), toBytes(coin1Result.result)];
    for (let i = 2; i < 8; i++) {
        const [nextCoinResult] = await client.multicall({
            allowFailure: true,
            ...blockTag(blockNumber),
            contracts: [
                { address: underlyingTokenAddressStr, abi: coinsAbi, functionName: 'coins', args: [BigInt(i)] },
            ],
        });
        if (nextCoinResult.status === 'failure') {
            break;
        }
        coins.push(toBytes(nextCoinResult.result));
    }

    const reserveResults = await client.multicall({
        allowFailure: true,
        ...blockTag(blockNumber),
        contracts: coins.map((_, index) => ({
            address: underlyingTokenAddressStr,
            abi: balancesAbi,
            functionName: 'balances',
            args: [BigInt(index)],
        })),
    });

    const balances: TokenBalance[] = [];
    for (let i = 0; i < coins.length; i++) {
        const reserveResult = reserveResults[i];
        const coin = coins[i];
        if (!reserveResult || reserveResult.status === 'failure' || !coin) {
            return [];
        }
        balances.push({
            tokenAddress: coin,
            rawBalance: (reserveResult.result * wantTotalBalance) / totalSupply,
        });
    }

    return balances;
};

const wantsAbi = [
    {
        inputs: [],
        name: 'wants',
        outputs: [
            { name: 'token0', type: 'address' },
            { name: 'token1', type: 'address' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
] as const;

const clmBalancesAbi = [
    {
        inputs: [],
        name: 'balances',
        outputs: [
            { name: 'amount0', type: 'uint256' },
            { name: 'amount1', type: 'uint256' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
] as const;

export const isBeefyClmVault = async ({
    client,
    vaultAddress,
    underlyingTokenAddress,
}: {
    client: PublicClient;
    vaultAddress: Bytes;
    underlyingTokenAddress: Bytes;
}): Promise<boolean> => {
    const breakdown = await getVaultTokenBreakdownBeefyClmVault({ client, vaultAddress, underlyingTokenAddress });
    return breakdown.length > 0;
};

export const getVaultTokenBreakdownBeefyClm = async ({
    client,
    vaultAddress,
    blockNumber,
}: {
    client: PublicClient;
    vaultAddress: Bytes;
    blockNumber?: number;
}): Promise<TokenBalance[]> => {
    const vaultAddressStr = toHex(vaultAddress);
    const [wantsResult, balancesResult] = await client.multicall({
        allowFailure: true,
        ...blockTag(blockNumber),
        contracts: [
            { address: vaultAddressStr, abi: wantsAbi, functionName: 'wants' },
            { address: vaultAddressStr, abi: clmBalancesAbi, functionName: 'balances' },
        ],
    });

    if (wantsResult.status === 'failure' || balancesResult.status === 'failure') {
        return [];
    }

    return [
        { tokenAddress: toBytes(wantsResult.result[0]), rawBalance: balancesResult.result[0] },
        { tokenAddress: toBytes(wantsResult.result[1]), rawBalance: balancesResult.result[1] },
    ];
};

export const getVaultTokenBreakdownBeefyClmVault = async ({
    client,
    vaultAddress,
    underlyingTokenAddress,
    blockNumber,
}: {
    client: PublicClient;
    vaultAddress: Bytes;
    underlyingTokenAddress: Bytes;
    blockNumber?: number;
}): Promise<TokenBalance[]> => {
    const vaultAddressStr = toHex(vaultAddress);
    const underlyingTokenAddressStr = toHex(underlyingTokenAddress);
    const [vaultBalanceResult, vaultTotalSupplyResult, clmTokensResult, clmBalancesResult] = await client.multicall({
        allowFailure: true,
        ...blockTag(blockNumber),
        contracts: [
            { address: vaultAddressStr, abi: balanceAbi, functionName: 'balance' },
            { address: vaultAddressStr, abi: totalSupplyAbi, functionName: 'totalSupply' },
            { address: underlyingTokenAddressStr, abi: wantsAbi, functionName: 'wants' },
            { address: underlyingTokenAddressStr, abi: clmBalancesAbi, functionName: 'balances' },
        ],
    });

    if (
        vaultBalanceResult.status === 'failure' ||
        vaultTotalSupplyResult.status === 'failure' ||
        clmTokensResult.status === 'failure' ||
        clmBalancesResult.status === 'failure'
    ) {
        return [];
    }

    const vaultBalance = vaultBalanceResult.result;
    const vaultTotalSupply = vaultTotalSupplyResult.result;
    const tokens = [clmTokensResult.result[0], clmTokensResult.result[1]];
    const totalBalances = [clmBalancesResult.result[0], clmBalancesResult.result[1]];

    return tokens.map((token, index) => ({
        tokenAddress: toBytes(token),
        rawBalance: vaultTotalSupply === 0n ? 0n : ((totalBalances[index] ?? 0n) * vaultBalance) / vaultTotalSupply,
    }));
};

export const PLATFORM_UNKNOWN = 'UNKNOWN';
export const PLATFORM_AAVE = 'AAVE';
export const PLATFORM_CURVE = 'CURVE';
export const PLATFORM_BEEFY_CLM = 'BEEFY_CLM';
export const PLATFORM_BEEFY_CLM_VAULT = 'BEEFY_CLM_VAULT';
export const PLATFORM_BEEFY_LST_VAULT = 'BEEFY_LST_VAULT';

const totalAssetsAbi = [
    { inputs: [], name: 'totalAssets', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

export const detectClassicVaultUnderlyingPlatform = async ({
    client,
    vaultAddress,
    strategyAddress,
    underlyingTokenAddress,
    underlyingPlatform,
}: {
    client: PublicClient;
    vaultAddress: Bytes;
    strategyAddress: Bytes;
    underlyingTokenAddress: Bytes;
    underlyingPlatform: string;
}): Promise<string> => {
    if (underlyingPlatform !== PLATFORM_UNKNOWN) {
        return underlyingPlatform;
    }

    if (await isAaveVault(client, strategyAddress)) {
        return PLATFORM_AAVE;
    }
    if (await isCurveVault({ client, vaultAddress, underlyingTokenAddress })) {
        return PLATFORM_CURVE;
    }
    if (await isBeefyClmVault({ client, vaultAddress, underlyingTokenAddress })) {
        return PLATFORM_BEEFY_CLM_VAULT;
    }
    const beefyClmBreakdown = await getVaultTokenBreakdownBeefyClm({ client, vaultAddress });
    if (beefyClmBreakdown.length > 0) {
        return PLATFORM_BEEFY_CLM;
    }

    const [totalAssetsResult] = await client.multicall({
        allowFailure: true,
        contracts: [{ address: toHex(vaultAddress), abi: totalAssetsAbi, functionName: 'totalAssets' }],
    });
    if (totalAssetsResult.status === 'success') {
        return PLATFORM_BEEFY_LST_VAULT;
    }

    return PLATFORM_UNKNOWN;
};

export const getVaultTokenBreakdown = async ({
    client,
    vaultAddress,
    strategyAddress,
    underlyingTokenAddress,
    underlyingPlatform,
    blockNumber,
}: {
    client: PublicClient;
    vaultAddress: Bytes;
    strategyAddress: Bytes;
    underlyingTokenAddress: Bytes;
    underlyingPlatform: string;
    blockNumber?: number;
}): Promise<TokenBalance[]> => {
    const platform =
        underlyingPlatform === PLATFORM_UNKNOWN
            ? await detectClassicVaultUnderlyingPlatform({
                  client,
                  vaultAddress,
                  strategyAddress,
                  underlyingTokenAddress,
                  underlyingPlatform,
              })
            : underlyingPlatform;

    if (platform === PLATFORM_AAVE) {
        return getVaultTokenBreakdownAave({ client, vaultAddress, underlyingTokenAddress, blockNumber });
    }
    if (platform === PLATFORM_CURVE) {
        return getVaultTokenBreakdownCurve({ client, vaultAddress, underlyingTokenAddress, blockNumber });
    }
    if (platform === PLATFORM_BEEFY_CLM) {
        return getVaultTokenBreakdownBeefyClm({ client, vaultAddress, blockNumber });
    }
    if (platform === PLATFORM_BEEFY_CLM_VAULT) {
        return getVaultTokenBreakdownBeefyClmVault({ client, vaultAddress, underlyingTokenAddress, blockNumber });
    }
    if (platform === PLATFORM_BEEFY_LST_VAULT) {
        const [totalAssetsResult] = await client.multicall({
            allowFailure: true,
            ...blockTag(blockNumber),
            contracts: [{ address: toHex(vaultAddress), abi: totalAssetsAbi, functionName: 'totalAssets' }],
        });
        if (totalAssetsResult.status === 'failure') {
            return [];
        }
        return [{ tokenAddress: underlyingTokenAddress, rawBalance: totalAssetsResult.result }];
    }

    if (platform === PLATFORM_UNKNOWN) {
        return [];
    }

    return getVaultTokenBreakdownAave({ client, vaultAddress, underlyingTokenAddress, blockNumber });
};
