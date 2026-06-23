import { createEffect } from 'envio';
import { staticVaultsMap } from '../config/classic/staticVaults';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import { hexSchema, normalizeHex } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { classicVaultAbi } from './abis/beefy/classic/ClassicVault';

export const getClassicVaultTokens = createEffect(
    {
        name: 'getClassicVaultTokens',
        input: {
            vaultAddress: hexSchema,
            chainId: chainIdSchema,
        },
        output: {
            shareTokenAddress: hexSchema,
            underlyingTokenAddress: hexSchema,
            strategyAddress: hexSchema,
            blacklistStatus: blacklistStatus,
        },
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const { vaultAddress, chainId } = input;

        const staticVault = staticVaultsMap[chainId]?.[normalizeHex(vaultAddress)];
        if (staticVault) {
            return {
                shareTokenAddress: vaultAddress,
                underlyingTokenAddress: staticVault.underlyingTokenAddress,
                strategyAddress: staticVault.strategyAddress,
                blacklistStatus: 'ok' as const,
            };
        }

        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClassicVault tokens', { vaultAddress, chainId });

        const [tokenResult, wantResult, strategyResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                // token (BeefyVaultV4 and before)
                {
                    address: vaultAddress as `0x${string}`,
                    abi: classicVaultAbi,
                    functionName: 'token',
                    args: [],
                },
                // token (BeefyVaultV5 and after)
                {
                    address: vaultAddress as `0x${string}`,
                    abi: classicVaultAbi,
                    functionName: 'want',
                    args: [],
                },
                {
                    address: vaultAddress as `0x${string}`,
                    abi: classicVaultAbi,
                    functionName: 'strategy',
                    args: [],
                },
            ],
        });

        // The vault contract itself is the share token
        const shareTokenAddress = vaultAddress;

        let underlyingTokenAddress: `0x${string}` | null = null;
        if (wantResult.status === 'success') {
            // vault v5 and after
            underlyingTokenAddress = wantResult.result;
        } else if (tokenResult.status === 'success') {
            // vault v4 and before
            underlyingTokenAddress = tokenResult.result;
        } else {
            context.log.error('ClassicVault want AND token call failed', { vaultAddress, chainId });
            return {
                shareTokenAddress,
                underlyingTokenAddress: ADDRESS_ZERO,
                strategyAddress: ADDRESS_ZERO,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        if (strategyResult.status === 'failure') {
            context.log.error('ClassicVault strategy call failed', { vaultAddress, chainId });
            throw new Error(`ClassicVault strategy call failed for ${vaultAddress} on chain ${chainId}`);
        }

        const strategyAddress = strategyResult.result;

        context.log.info('ClassicVault data fetched', {
            vaultAddress,
            shareTokenAddress,
            underlyingTokenAddress,
            strategyAddress,
        });

        if (underlyingTokenAddress === ADDRESS_ZERO) {
            return {
                shareTokenAddress,
                underlyingTokenAddress,
                strategyAddress,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress,
            underlyingTokenAddress,
            strategyAddress,
            blacklistStatus: 'ok' as const,
        };
    }
);
