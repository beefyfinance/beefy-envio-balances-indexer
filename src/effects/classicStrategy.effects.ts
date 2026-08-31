import { createEffect, S } from 'envio';
import { staticStrategyVaultMap } from '../config/classic/staticVaults';
import { chainIdSchema } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import { hexSchema, normalizeHex } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { classicStrategyAbi } from './abis/beefy/classic/ClassicStrategy';

export const getClassicStrategyVault = createEffect(
    {
        name: 'getClassicStrategyVault',
        input: {
            strategyAddress: hexSchema,
            chainId: chainIdSchema,
            blockNumber: S.number,
        },
        output: {
            vaultAddress: hexSchema,
        },
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const { strategyAddress, chainId, blockNumber } = input;
        const normalizedStrategy = normalizeHex(strategyAddress);

        const staticVaultAddress = staticStrategyVaultMap[chainId]?.[normalizedStrategy];
        if (staticVaultAddress) {
            return { vaultAddress: staticVaultAddress };
        }

        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClassicStrategy vault', { strategyAddress, chainId });

        const [vaultResult] = await client.multicall({
            allowFailure: true,
            blockNumber: BigInt(blockNumber),
            contracts: [
                {
                    address: strategyAddress as `0x${string}`,
                    abi: classicStrategyAbi,
                    functionName: 'vault',
                    args: [],
                },
            ],
        });

        if (vaultResult.status === 'failure') {
            context.log.error('ClassicStrategy vault call failed', { strategyAddress, chainId });
            return {
                vaultAddress: ADDRESS_ZERO,
            };
        }

        const vaultAddress = normalizeHex(vaultResult.result);

        context.log.info('ClassicStrategy vault fetched', {
            strategyAddress,
            vaultAddress,
        });

        return {
            vaultAddress,
        };
    }
);
