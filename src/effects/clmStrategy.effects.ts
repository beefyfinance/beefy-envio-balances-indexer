import { createEffect, S } from 'envio';
import { chainIdSchema } from '../lib/chain';
import { decodeEffectInput } from '../lib/effect';
import { asHex, hexSchema, toHex, ZERO_ADDRESS_HEX } from '../lib/hex';
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
        const { strategyAddress, chainId, blockNumber } = decodeEffectInput(input);
        const strategyAddressStr = toHex(strategyAddress);
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClmStrategy manager', { strategyAddress: strategyAddressStr, chainId });

        const [vaultResult] = await client.multicall({
            allowFailure: true,
            blockNumber: BigInt(blockNumber),
            contracts: [
                {
                    address: strategyAddressStr,
                    abi: clmStrategyAbi,
                    functionName: 'vault',
                    args: [],
                },
            ],
        });

        if (vaultResult.status === 'failure') {
            context.log.error('ClmStrategy vault call failed', { strategyAddress: strategyAddressStr, chainId });
            return {
                managerAddress: ZERO_ADDRESS_HEX,
            };
        }

        const managerAddressStr = asHex(vaultResult.result);

        context.log.info('ClmStrategy manager fetched', {
            strategyAddress: strategyAddressStr,
            managerAddress: managerAddressStr,
        });

        return {
            managerAddress: managerAddressStr,
        };
    }
);
