import { createEffect } from 'envio';
import type { Hex } from 'viem';
import { chainIdSchema } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import { hexSchema } from '../lib/hex';
import { getViemClient } from '../lib/viem';

export const getClmStrategyManager = createEffect(
    {
        name: 'getClmStrategyManager',
        input: {
            strategyAddress: hexSchema,
            chainId: chainIdSchema,
        },
        output: {
            managerAddress: hexSchema,
        },
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const { strategyAddress, chainId } = input;
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClmStrategy manager', { strategyAddress, chainId });

        const [vaultResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: strategyAddress as `0x${string}`,
                    abi: [
                        {
                            inputs: [],
                            name: 'vault',
                            outputs: [{ name: '', type: 'address' }],
                            stateMutability: 'view',
                            type: 'function',
                        },
                    ],
                    functionName: 'vault',
                    args: [],
                },
            ],
        });

        if (vaultResult.status === 'failure') {
            context.log.error('ClmStrategy vault call failed', { strategyAddress, chainId });
            return {
                managerAddress: ADDRESS_ZERO,
            };
        }

        const managerAddress = vaultResult.result.toLowerCase() as Hex;

        context.log.info('ClmStrategy manager fetched', {
            strategyAddress,
            managerAddress,
        });

        return {
            managerAddress,
        };
    }
);
