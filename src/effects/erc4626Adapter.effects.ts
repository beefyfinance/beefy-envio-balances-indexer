import { createEffect } from 'envio';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import { hexSchema } from '../lib/hex';
import { getViemClient } from '../lib/viem';

export const getErc4626AdapterTokens = createEffect(
    {
        name: 'getErc4626AdapterTokens',
        input: {
            adapterAddress: hexSchema,
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
        const { adapterAddress, chainId } = input;
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching Erc4626Adapter tokens', { adapterAddress, chainId });

        const [underlyingTokenResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: adapterAddress as `0x${string}`,
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

        // The adapter contract itself is the share token
        const shareTokenAddress = adapterAddress;

        if (underlyingTokenResult.status === 'failure') {
            context.log.error('Erc4626Adapter asset call failed', { adapterAddress, chainId });
            return {
                shareTokenAddress,
                underlyingTokenAddress: ADDRESS_ZERO,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        const underlyingTokenAddress = underlyingTokenResult.result;

        context.log.info('Erc4626Adapter data fetched', { adapterAddress, shareTokenAddress, underlyingTokenAddress });

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
