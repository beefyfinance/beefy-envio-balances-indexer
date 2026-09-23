import { createEffect, S } from 'envio';
import { chainIdSchema } from '../lib/chain';
import { decodeEffectInput } from '../lib/effect';
import { asHex, hexSchema, toHex, ZERO_ADDRESS_HEX } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { beefySwapperAbi } from './abis/beefy/common/BeefySwapper';

export const getSwapperConfig = createEffect(
    {
        name: 'getSwapperConfig',
        input: {
            swapperAddress: hexSchema,
            chainId: chainIdSchema,
            blockNumber: S.number,
        },
        output: {
            oracle: hexSchema,
            slippage: S.bigint,
        },
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const { swapperAddress, chainId, blockNumber } = decodeEffectInput(input);
        const swapperAddressStr = toHex(swapperAddress);
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching BeefySwapper oracle and slippage', { swapperAddress: swapperAddressStr, chainId });

        const [oracleResult, slippageResult] = await client.multicall({
            allowFailure: true,
            blockNumber: BigInt(blockNumber),
            contracts: [
                {
                    address: swapperAddressStr,
                    abi: beefySwapperAbi,
                    functionName: 'oracle',
                    args: [],
                },
                {
                    address: swapperAddressStr,
                    abi: beefySwapperAbi,
                    functionName: 'slippage',
                    args: [],
                },
            ],
        });

        if (oracleResult.status === 'failure') {
            context.log.error('BeefySwapper oracle call failed', { swapperAddress: swapperAddressStr, chainId });
        }
        if (slippageResult.status === 'failure') {
            context.log.error('BeefySwapper slippage call failed', { swapperAddress: swapperAddressStr, chainId });
        }

        return {
            oracle: oracleResult.status === 'success' ? asHex(oracleResult.result) : ZERO_ADDRESS_HEX,
            slippage: slippageResult.status === 'success' ? slippageResult.result : 0n,
        };
    }
);
