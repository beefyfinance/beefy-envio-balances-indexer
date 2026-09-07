import { createEffect, S } from 'envio';
import { staticStrategyVaultMap } from '../config/classic/staticVaults';
import { chainIdSchema } from '../lib/chain';
import { decodeEffectInput } from '../lib/effect';
import { asHex, hexSchema, toHex, ZERO_ADDRESS_HEX } from '../lib/hex';
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
        const { strategyAddress, chainId, blockNumber } = decodeEffectInput(input);
        const strategyAddressStr = toHex(strategyAddress);

        const staticVaultAddress = staticStrategyVaultMap[chainId]?.[strategyAddressStr];
        if (staticVaultAddress) {
            return { vaultAddress: toHex(staticVaultAddress) };
        }

        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClassicStrategy vault', { strategyAddress: strategyAddressStr, chainId });

        const [vaultResult] = await client.multicall({
            allowFailure: true,
            blockNumber: BigInt(blockNumber),
            contracts: [
                {
                    address: strategyAddressStr,
                    abi: classicStrategyAbi,
                    functionName: 'vault',
                    args: [],
                },
            ],
        });

        if (vaultResult.status === 'failure') {
            context.log.error('ClassicStrategy vault call failed', { strategyAddress: strategyAddressStr, chainId });
            return {
                vaultAddress: ZERO_ADDRESS_HEX,
            };
        }

        const vaultAddressStr = asHex(vaultResult.result);

        context.log.info('ClassicStrategy vault fetched', {
            strategyAddress: strategyAddressStr,
            vaultAddress: vaultAddressStr,
        });

        return {
            vaultAddress: vaultAddressStr,
        };
    }
);
