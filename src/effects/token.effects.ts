import { createEffect, S } from 'envio';
import { erc20Abi } from 'viem';
import { chainIdSchema } from '../lib/chain';
import { hexSchema } from '../lib/hex';
import { getViemClient } from '../lib/viem';

export const getTokenMetadata = createEffect(
    {
        name: 'getTokenMetadata',
        input: {
            tokenAddress: hexSchema,
            chainId: chainIdSchema,
        },
        output: S.schema({
            name: S.string,
            symbol: S.string,
            decimals: S.number,
        }),
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const { tokenAddress, chainId } = input;

        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching token metadata', { tokenAddress, chainId });

        // Try standard Erc20 interface first (most common)
        const erc20 = {
            address: tokenAddress as `0x${string}`,
            abi: erc20Abi,
        } as const;
        const [decimals, name, symbol] = await client.multicall({
            allowFailure: false,
            contracts: [
                {
                    ...erc20,
                    functionName: 'decimals',
                    args: [],
                },
                {
                    ...erc20,
                    functionName: 'name',
                    args: [],
                },
                {
                    ...erc20,
                    functionName: 'symbol',
                    args: [],
                },
            ],
        });

        context.log.info('Got token details', { tokenAddress, name, symbol, decimals });

        return {
            name,
            symbol,
            decimals,
        };
    }
);
