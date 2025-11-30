import { createEffect } from 'envio';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import { hexSchema } from '../lib/hex';
import { getViemClient } from '../lib/viem';

export const getLstVaultTokens = createEffect(
    {
        name: 'getLstVaultTokens',
        input: {
            lstAddress: hexSchema,
            chainId: chainIdSchema,
        },
        output: {
            shareTokenAddress: hexSchema,
            underlyingTokenAddress: hexSchema,
            blacklistStatus: blacklistStatus,
        },
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const { lstAddress, chainId } = input;
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching LstVault tokens', { lstAddress, chainId });

        const [underlyingTokenResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: lstAddress as `0x${string}`,
                    abi: [
                        {
                            inputs: [],
                            name: 'asset',
                            outputs: [{ name: '', type: 'address' }],
                            stateMutability: 'view',
                            type: 'function',
                        },
                    ],
                    functionName: 'asset',
                    args: [],
                },
            ],
        });

        // The LST contract itself is the share token
        const shareTokenAddress = lstAddress;

        if (underlyingTokenResult.status === 'failure') {
            context.log.error('LstVault asset call failed', { lstAddress, chainId });
            return {
                shareTokenAddress,
                underlyingTokenAddress: ADDRESS_ZERO,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        const underlyingTokenAddress = underlyingTokenResult.result;

        context.log.info('LstVault data fetched', { lstAddress, shareTokenAddress, underlyingTokenAddress });

        if (underlyingTokenAddress === ADDRESS_ZERO) {
            return {
                shareTokenAddress,
                underlyingTokenAddress,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress,
            underlyingTokenAddress,
            blacklistStatus: 'ok' as const,
        };
    }
);
