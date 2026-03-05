import { decodeFunctionData } from 'viem';
import type { ChainId } from '../lib/chain';
import type { HandlerContext } from '../lib/schema';
import { getViemClient } from '../lib/viem';

const detectClassicVaultOrStrategyWithEthCall = async ({
    contractAddress,
    chainId,
    blockNumber,
    transactionHash,
    log,
}: {
    contractAddress: `0x${string}`;
    chainId: ChainId;
    blockNumber?: number;
    transactionHash: `0x${string}`;
    log: HandlerContext['log'];
}): Promise<{
    isVault: boolean;
    isStrategy: boolean;
    isBoost: boolean;
}> => {
    const client = getViemClient(chainId, log);

    // Try standard Erc20 interface first (most common)
    const [vault, strategy, rewardToken] = await client.multicall({
        allowFailure: true,
        contracts: [
            {
                address: contractAddress as `0x${string}`,
                abi: [
                    {
                        name: 'vault',
                        type: 'function',
                        inputs: [],
                        outputs: [],
                    },
                ],
                functionName: 'vault',
                args: [],
            },
            {
                address: contractAddress as `0x${string}`,
                abi: [
                    {
                        name: 'strategy',
                        type: 'function',
                        inputs: [],
                        outputs: [],
                    },
                ],
                functionName: 'strategy',
                args: [],
            },
            {
                address: contractAddress as `0x${string}`,
                abi: [
                    {
                        name: 'rewardToken',
                        type: 'function',
                        inputs: [],
                        outputs: [],
                    },
                ],
                functionName: 'rewardToken',
                args: [],
            },
        ],
        blockNumber: blockNumber ? BigInt(blockNumber) : undefined,
    });

    log.debug('vault or strategy detection', {
        contractAddress,
        transactionHash,
        vault: vault.status,
        strategy: strategy.status,
        blockNumber,
    });

    if (vault.status === 'failure' && strategy.status === 'failure' && rewardToken.status === 'failure') {
        log.error('.vault() and .strategy() and .rewardToken() calls failed on contract', {
            chainId,
            contractAddress,
            transactionHash,
            vault: vault.error,
            strategy: strategy.error,
            blockNumber,
        });
        throw new Error(
            `.vault() and .strategy() and .rewardToken() calls FAILED for contract ${chainId}:${contractAddress} with transaction hash ${transactionHash}`
        );
    }

    let successes = 0;
    if (vault.status === 'success') successes++;
    if (strategy.status === 'success') successes++;
    if (rewardToken.status === 'success') successes++;

    if (successes > 1) {
        log.error('More than one function succeeded on contract, this is not expected', {
            contractAddress,
            transactionHash,
            blockNumber,
            vaultResult: vault.status,
            strategyResult: strategy.status,
            rewardTokenResult: rewardToken.status,
        });
        throw new Error(
            `More than one function succeeded on contract ${chainId}:${contractAddress} with transaction hash ${transactionHash}. vault: ${vault.status}, strategy: ${strategy.status}, rewardToken: ${rewardToken.status}.`
        );
    }

    return {
        isVault: strategy.status === 'success',
        isStrategy: vault.status === 'success',
        isBoost: rewardToken.status === 'success',
    };
};

const vaultOrStrategyFactoryAbi = [
    {
        inputs: [{ internalType: 'address', name: 'implementation', type: 'address' }],
        name: 'cloneContract',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [],
        name: 'cloneVault',
        outputs: [{ internalType: 'contract BeefyVaultV7', name: '', type: 'address' }],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'address', name: 'mooToken', type: 'address' },
            { internalType: 'address', name: 'rewardToken', type: 'address' },
            { internalType: 'uint256', name: 'duration_in_sec', type: 'uint256' },
        ],
        name: 'booooost',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
] as const;

const detectClassicVaultOrStrategyWithTransactionInput = async ({
    transactionInput,
}: {
    transactionInput: `0x${string}`;
}) => {
    const trxData = decodeFunctionData({
        abi: vaultOrStrategyFactoryAbi,
        data: transactionInput,
    });

    if (trxData.functionName === 'cloneVault') {
        return {
            isStrategy: false,
            isVault: true,
            isBoost: false,
        };
    }

    if (trxData.functionName === 'cloneContract') {
        return {
            isStrategy: true,
            isVault: false,
            isBoost: false,
        };
    }

    if (trxData.functionName === 'booooost') {
        return {
            isStrategy: false,
            isVault: false,
            isBoost: true,
        };
    }

    return {
        isStrategy: false,
        isVault: false,
        isBoost: false,
    };
};

export async function detectClassicVaultOrStrategy({
    contractAddress,
    chainId,
    transactionInput,
    transactionHash,
    blockNumber,
    log,
}: {
    contractAddress: `0x${string}`;
    chainId: ChainId;
    transactionInput: `0x${string}`;
    transactionHash: `0x${string}`;
    blockNumber?: number;
    log: HandlerContext['log'];
}): Promise<{
    isStrategy: boolean;
    isVault: boolean;
    isBoost: boolean;
}> {
    try {
        // try the fast decode of trx input first
        const { isStrategy, isVault, isBoost } = await detectClassicVaultOrStrategyWithTransactionInput({
            transactionInput,
        });

        log.debug('detected classic vault or strategy with transaction input', {
            isStrategy,
            isVault,
            isBoost,
            transactionInput,
            transactionHash,
            contractAddress,
            chainId,
            blockNumber,
        });
        return { isStrategy, isVault, isBoost };
    } catch (error) {
        // fallback to slow eth call
        log.warn('Failed to decode transaction input, falling back to eth call', { transactionHash, error });
        const { isStrategy, isVault, isBoost } = await detectClassicVaultOrStrategyWithEthCall({
            contractAddress,
            chainId,
            blockNumber,
            transactionHash,
            log,
        });
        log.debug('detected classic vault or strategy with eth call', {
            isStrategy,
            isVault,
            isBoost,
            contractAddress,
            chainId,
            blockNumber,
        });
        return { isStrategy, isVault, isBoost };
    }
}
