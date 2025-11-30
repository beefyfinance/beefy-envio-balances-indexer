import { createEffect } from 'envio';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import { hexSchema } from '../lib/hex';
import { getViemClient } from '../lib/viem';

export const getClmManagerTokens = createEffect(
    {
        name: 'getClmManagerTokens',
        input: {
            managerAddress: hexSchema,
            chainId: chainIdSchema,
        },
        output: {
            shareTokenAddress: hexSchema,
            underlyingToken0Address: hexSchema,
            underlyingToken1Address: hexSchema,
            blacklistStatus: blacklistStatus,
        },
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const { managerAddress, chainId } = input;
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClmManager tokens', { managerAddress, chainId });

        const [wantsResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: managerAddress as `0x${string}`,
                    abi: [
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
                    ],
                    functionName: 'wants',
                    args: [],
                },
            ],
        });

        // The manager contract itself is the share token
        const shareTokenAddress = managerAddress;

        if (wantsResult.status === 'failure') {
            context.log.error('ClmManager wants call failed', { managerAddress, chainId });
            return {
                shareTokenAddress,
                underlyingToken0Address: ADDRESS_ZERO,
                underlyingToken1Address: ADDRESS_ZERO,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        const [underlyingToken0Address, underlyingToken1Address] = wantsResult.result;

        context.log.info('ClmManager data fetched', {
            managerAddress,
            shareTokenAddress,
            underlyingToken0Address,
            underlyingToken1Address,
        });

        if (underlyingToken0Address === ADDRESS_ZERO || underlyingToken1Address === ADDRESS_ZERO) {
            return {
                shareTokenAddress,
                underlyingToken0Address,
                underlyingToken1Address,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress,
            underlyingToken0Address,
            underlyingToken1Address,
            blacklistStatus: 'ok' as const,
        };
    }
);
