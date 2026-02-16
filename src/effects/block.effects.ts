import { createEffect, S } from 'envio';
import { chainIdSchema } from '../lib/chain';
import { getViemClient } from '../lib/viem';

/**
 * Fetches the block from the chain and returns its timestamp (seconds).
 * Use this instead of estimating timestamp from block number × block time.
 */
export const getBlockTimestamp = createEffect(
    {
        name: 'getBlockTimestamp',
        input: {
            chainId: chainIdSchema,
            blockNumber: S.number,
        },
        output: S.schema({
            timestamp: S.number,
        }),
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const client = getViemClient(input.chainId, context.log);
        const block = await client.getBlock({
            blockNumber: BigInt(input.blockNumber),
        });
        const timestamp = Number(block.timestamp);
        return { timestamp };
    }
);
