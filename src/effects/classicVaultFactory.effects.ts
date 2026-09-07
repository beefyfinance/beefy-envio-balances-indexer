import type { EvmChainId, EvmOnEventContext } from 'envio';
import { decodeFunctionData } from 'viem';
import { type Bytes, toHex } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { classicVaultFactoryAbi, classicVaultFactoryDetectionAbi } from './abis/beefy/classic/ClassicVaultFactory';

const detectClassicVaultOrStrategyWithEthCall = async ({
    contractAddress,
    chainId,
    blockNumber,
    transactionHash,
    log,
}: {
    contractAddress: Bytes;
    chainId: EvmChainId;
    blockNumber?: number;
    transactionHash: `0x${string}`;
    log: EvmOnEventContext['log'];
}): Promise<{
    isVault: boolean;
    isStrategy: boolean;
    isBoost: boolean;
}> => {
    const client = getViemClient(chainId, log);
    const contractAddressStr = toHex(contractAddress);

    // Try standard Erc20 interface first (most common)
    const [vault, strategy, rewardToken] = await client.multicall({
        allowFailure: true,
        contracts: [
            {
                address: contractAddressStr,
                abi: classicVaultFactoryDetectionAbi,
                functionName: 'vault',
                args: [],
            },
            {
                address: contractAddressStr,
                abi: classicVaultFactoryDetectionAbi,
                functionName: 'strategy',
                args: [],
            },
            {
                address: contractAddressStr,
                abi: classicVaultFactoryDetectionAbi,
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
            `.vault() and .strategy() and .rewardToken() calls FAILED for contract ${chainId}:${contractAddressStr} with transaction hash ${transactionHash}`
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
            `More than one function succeeded on contract ${chainId}:${contractAddressStr} with transaction hash ${transactionHash}. vault: ${vault.status}, strategy: ${strategy.status}, rewardToken: ${rewardToken.status}.`
        );
    }

    return {
        isVault: strategy.status === 'success',
        isStrategy: vault.status === 'success',
        isBoost: rewardToken.status === 'success',
    };
};

const detectClassicVaultOrStrategyWithTransactionInput = async ({
    transactionInput,
}: {
    transactionInput: `0x${string}`;
}) => {
    const trxData = decodeFunctionData({
        abi: classicVaultFactoryAbi,
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
    contractAddress: Bytes;
    chainId: EvmChainId;
    transactionInput: `0x${string}`;
    transactionHash: `0x${string}`;
    blockNumber?: number;
    log: EvmOnEventContext['log'];
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
