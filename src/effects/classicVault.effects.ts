import { createEffect } from 'envio';
import { staticVaultsMap } from '../config/classic/staticVaults';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { decodeEffectInput } from '../lib/effect';
import { asHex, hexSchema, toHex, ZERO_ADDRESS_HEX } from '../lib/hex';
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
        crossChain: false,
    },
    async ({ input, context }) => {
        const { vaultAddress, chainId } = decodeEffectInput(input);
        const vaultAddressStr = toHex(vaultAddress);

        const staticVault = staticVaultsMap[chainId]?.[vaultAddressStr];
        if (staticVault) {
            return {
                shareTokenAddress: vaultAddressStr,
                underlyingTokenAddress: toHex(staticVault.underlyingTokenAddress),
                strategyAddress: toHex(staticVault.strategyAddress),
                blacklistStatus: 'ok' as const,
            };
        }

        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClassicVault tokens', { vaultAddress: vaultAddressStr, chainId });

        const [tokenResult, wantResult, strategyResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: vaultAddressStr,
                    abi: classicVaultAbi,
                    functionName: 'token',
                    args: [],
                },
                {
                    address: vaultAddressStr,
                    abi: classicVaultAbi,
                    functionName: 'want',
                    args: [],
                },
                {
                    address: vaultAddressStr,
                    abi: classicVaultAbi,
                    functionName: 'strategy',
                    args: [],
                },
            ],
        });

        let underlyingTokenAddressStr = ZERO_ADDRESS_HEX;
        if (wantResult.status === 'success') {
            underlyingTokenAddressStr = asHex(wantResult.result);
        } else if (tokenResult.status === 'success') {
            underlyingTokenAddressStr = asHex(tokenResult.result);
        } else {
            context.log.error('ClassicVault want AND token call failed', { vaultAddress: vaultAddressStr, chainId });
            return {
                shareTokenAddress: vaultAddressStr,
                underlyingTokenAddress: ZERO_ADDRESS_HEX,
                strategyAddress: ZERO_ADDRESS_HEX,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        if (strategyResult.status === 'failure') {
            context.log.error('ClassicVault strategy call failed', { vaultAddress: vaultAddressStr, chainId });
            throw new Error(`ClassicVault strategy call failed for ${vaultAddressStr} on chain ${chainId}`);
        }

        const strategyAddressStr = asHex(strategyResult.result);

        context.log.info('ClassicVault data fetched', {
            vaultAddress: vaultAddressStr,
            shareTokenAddress: vaultAddressStr,
            underlyingTokenAddress: underlyingTokenAddressStr,
            strategyAddress: strategyAddressStr,
        });

        if (underlyingTokenAddressStr === ZERO_ADDRESS_HEX) {
            return {
                shareTokenAddress: vaultAddressStr,
                underlyingTokenAddress: underlyingTokenAddressStr,
                strategyAddress: strategyAddressStr,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress: vaultAddressStr,
            underlyingTokenAddress: underlyingTokenAddressStr,
            strategyAddress: strategyAddressStr,
            blacklistStatus: 'ok' as const,
        };
    }
);
