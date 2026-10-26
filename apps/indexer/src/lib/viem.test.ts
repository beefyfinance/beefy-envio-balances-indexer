import type { Logger } from 'envio';
import { decodeFunctionData, encodeFunctionResult, type Hex, multicall3Abi } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ierc20Abi } from '../effects/abis/IERC20/IERC20';
import { getViemClient } from './viem';

// Exercise the real batching path against a local JSON-RPC stub instead of a live node.
process.env.RPC_FIXTURES = 'off';

const DEAD = '0x000000000000000000000000000000000000dead';
const decimalsAbi = [
    { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
] as const;
/** Returns a 160-bit value (an address) where a uint8 is expected: decoding fails on the client. */
const ADDRESS_RETURNER = '0x00000000000000000000000000000000000000aa';
const TOKENS = [
    '0xca3f508b8e4dd382ee878a314789373d80a5190a',
    '0x55d398326f99059ff775485246999027b3197955',
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    '0xe9e7cea3dedca5984780bafc599bd69add087d56',
] as const;
const BLOCK = 40_000_000n;

/** Sub-call count of every eth_call received, in order. */
const ethCalls: number[] = [];
/** Block tag of every eth_call received, in order. */
const ethCallBlocks: string[] = [];

vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const request = JSON.parse(init.body) as { id: number; method: string; params: [{ data: Hex }, string] };
    if (request.method !== 'eth_call') throw new Error(`unexpected ${request.method}`);
    const { args } = decodeFunctionData({ abi: multicall3Abi, data: request.params[0].data });
    const calls = args[0] as readonly { target: string }[];
    ethCalls.push(calls.length);
    ethCallBlocks.push(request.params[1]);
    const result = encodeFunctionResult({
        abi: multicall3Abi,
        functionName: 'aggregate3',
        // every token reports a totalSupply of 1, the EOA returns no data
        result: calls.map(({ target }) => ({
            success: true,
            returnData:
                target.toLowerCase() === DEAD
                    ? '0x'
                    : encodeFunctionResult({
                          abi: ierc20Abi,
                          functionName: 'totalSupply',
                          result: target.toLowerCase() === ADDRESS_RETURNER ? 2n ** 159n + 1n : 1n,
                      }),
        })),
    });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
        headers: { 'content-type': 'application/json' },
    });
});

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;

beforeEach(() => {
    ethCalls.length = 0;
    ethCallBlocks.length = 0;
});

describe('getViemClient multicall batching', () => {
    it('packs concurrent multicalls at the same block into shared eth_calls', async () => {
        // first client created for chain 56 in this file, so it logs through this logger
        const client = getViemClient(56, logger);

        const results = await Promise.all(
            Array.from({ length: 20 }, () =>
                client.multicall({
                    allowFailure: true,
                    blockNumber: BLOCK,
                    contracts: TOKENS.map((address) => ({
                        address,
                        abi: ierc20Abi,
                        functionName: 'totalSupply' as const,
                    })),
                })
            )
        );

        expect(results).toHaveLength(20);
        for (const result of results) {
            expect(result.map((r) => r.status)).toEqual(['success', 'success', 'success', 'success']);
        }
        // 80 reads in 20 multicall groups; groups are packed by up to 64 calls
        expect(ethCalls).toEqual([64, 16]);
    });

    it('never splits one multicall group across eth_calls', async () => {
        const client = getViemClient(10, logger);
        // 100 sub-calls > merge budget: still a single EVM execution
        const contracts = Array.from({ length: 100 }, () => ({
            address: '0x4200000000000000000000000000000000000006',
            abi: ierc20Abi,
            functionName: 'totalSupply',
        })) as { address: `0x${string}`; abi: typeof ierc20Abi; functionName: 'totalSupply' }[];

        const results = await client.multicall({ allowFailure: true, blockNumber: 120_000_000n, contracts });

        expect(results.every((r) => r.status === 'success')).toBe(true);
        expect(ethCalls).toEqual([100]);
    });

    it('resolves a group whose every call fails to decode, without retrying it', async () => {
        // regression: a vault whose calls all returned undecodable data was treated as a failed request,
        // retried, then rejected, which crashed the indexer
        const client = getViemClient(56, logger);
        const results = await client.multicall({
            allowFailure: true,
            blockNumber: BLOCK,
            contracts: [
                { address: ADDRESS_RETURNER, abi: decimalsAbi, functionName: 'decimals' as const },
                { address: ADDRESS_RETURNER, abi: decimalsAbi, functionName: 'decimals' as const },
            ],
        });
        expect(results.map((r) => r.status)).toEqual(['failure', 'failure']);
        expect(ethCalls).toEqual([2]);
    });

    it('keeps per-call failures isolated', async () => {
        const client = getViemClient(56, logger);
        const [ok, reverted] = await client.multicall({
            allowFailure: true,
            blockNumber: BLOCK,
            contracts: [
                { address: TOKENS[2], abi: ierc20Abi, functionName: 'totalSupply' as const },
                // EOA: no code, decoding the empty return data fails
                { address: DEAD, abi: ierc20Abi, functionName: 'totalSupply' as const },
            ],
        });
        expect(ok?.status).toBe('success');
        expect(reverted?.status).toBe('failure');
    });

    it('merges concurrent unpinned (latest) multicalls into one eth_call at latest', async () => {
        const client = getViemClient(56, logger);
        const results = await Promise.all(
            TOKENS.map((address) =>
                client.multicall({
                    allowFailure: true,
                    contracts: [{ address, abi: ierc20Abi, functionName: 'totalSupply' as const }],
                })
            )
        );
        expect(results.map(([r]) => r?.status)).toEqual(['success', 'success', 'success', 'success']);
        expect(ethCalls).toEqual([4]);
        expect(ethCallBlocks).toEqual(['latest']);
    });
});
