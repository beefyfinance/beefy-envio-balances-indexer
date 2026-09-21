import { createEffect, S } from 'envio';
import { chainIdSchema } from '../lib/chain';
import { getViemClient } from '../lib/viem';

// The Beefy RPC proxy sometimes answers historical eth_getBlockByNumber with
// "block not found" from an upstream that has no archive data. Viem does not
// retry that JSON-RPC error, so the hourly clock handler crashes. A later
// attempt often lands on an upstream that has the block.
const MISSING_BLOCK_RETRIES = 3;
const MISSING_BLOCK_RETRY_DELAY_MS = 1_000;

const isMissingBlockError = (error: unknown) => {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const err = error as { code?: number; details?: string; message?: string; shortMessage?: string };
    if (err.code === -32014) {
        return true;
    }
    const text = `${err.shortMessage ?? ''} ${err.details ?? ''} ${err.message ?? ''}`;
    return text.includes('block not found') || text.includes('ErrEndpointMissingData');
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
        crossChain: false,
    },
    async ({ input, context }) => {
        const client = getViemClient(input.chainId, context.log);
        const blockNumber = BigInt(input.blockNumber);

        for (let attempt = 0; attempt <= MISSING_BLOCK_RETRIES; attempt++) {
            try {
                const block = await client.getBlock({ blockNumber });
                return { timestamp: Number(block.timestamp) };
            } catch (error) {
                const retry = attempt < MISSING_BLOCK_RETRIES && isMissingBlockError(error);
                if (!retry) {
                    throw error;
                }
                context.log.warn('Block timestamp lookup missed the block, retrying', {
                    chainId: input.chainId,
                    blockNumber: input.blockNumber,
                    attempt: attempt + 1,
                });
                await delay(MISSING_BLOCK_RETRY_DELAY_MS);
            }
        }

        throw new Error(`Block ${input.blockNumber} on chain ${input.chainId} not found`);
    }
);
