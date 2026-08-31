import { createEffect, S } from 'envio';
import { chainIdSchema } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import { hexSchema, normalizeHex } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { clmStrategyAbi } from './abis/beefy/clm/ClmStrategy';

export const getClmStrategyManager = createEffect(
    {
        name: 'getClmStrategyManager',
        input: {
            strategyAddress: hexSchema,
            chainId: chainIdSchema,
            blockNumber: S.number,
        },
        output: {
            managerAddress: hexSchema,
        },
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const { strategyAddress, chainId, blockNumber } = input;
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClmStrategy manager', { strategyAddress, chainId });

        const [vaultResult] = await client.multicall({
            allowFailure: true,
            blockNumber: BigInt(blockNumber),
            contracts: [
                {
                    address: strategyAddress as `0x${string}`,
                    abi: clmStrategyAbi,
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

        const managerAddress = normalizeHex(vaultResult.result);

        context.log.info('ClmStrategy manager fetched', {
            strategyAddress,
            managerAddress,
        });

        return {
            managerAddress,
        };
    }
);
