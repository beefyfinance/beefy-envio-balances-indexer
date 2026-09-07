import { createEffect, S } from 'envio';
import { erc20Abi } from 'viem';
import { chainIdSchema } from '../lib/chain';
import { decodeEffectInput } from '../lib/effect';
import { hexSchema, toHex } from '../lib/hex';
import { getViemClient } from '../lib/viem';

export const getTokenMetadata = createEffect(
    {
        name: 'getTokenMetadata',
        input: {
            tokenAddress: hexSchema,
            chainId: chainIdSchema,
        },
        // Discriminated output:
        // - `status: 'ok'`  -> name/symbol/decimals are populated from the contract.
        // - `status: 'invalid'` -> the multicall succeeded (RPC responded) but one or
        //   more of `decimals()` / `name()` / `symbol()` reverted on chain.
        // We never return `'invalid'` for transport-level failures: those throw so
        // envio can retry the batch and so the operator sees the crash.
        output: S.schema({
            status: S.union(['ok', 'invalid']),
            name: S.string,
            symbol: S.string,
            decimals: S.number,
        }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const { tokenAddress, chainId } = decodeEffectInput(input);
        const tokenAddressStr = toHex(tokenAddress);

        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching token metadata', { tokenAddress: tokenAddressStr, chainId });

        const erc20 = {
            address: tokenAddressStr,
            abi: erc20Abi,
        } as const;

        // Intentionally use `allowFailure: true` so that on-chain reverts surface as
        // per-call `{ status: 'failure' }` instead of throwing. Transport-level
        // failures (RPC down, timeout) still throw from `multicall(...)` and propagate
        // up — the indexer will crash, envio will retry, and nothing is cached.
        const [decimalsResult, nameResult, symbolResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                { ...erc20, functionName: 'decimals', args: [] },
                { ...erc20, functionName: 'name', args: [] },
                { ...erc20, functionName: 'symbol', args: [] },
            ],
        });

        if (
            decimalsResult.status === 'failure' ||
            nameResult.status === 'failure' ||
            symbolResult.status === 'failure'
        ) {
            context.log.error('[INVALID_TOKEN] token metadata calls reverted', {
                tokenAddress: tokenAddressStr,
                chainId,
                decimals: decimalsResult.status,
                name: nameResult.status,
                symbol: symbolResult.status,
                decimalsError: decimalsResult.status === 'failure' ? decimalsResult.error?.message : undefined,
                nameError: nameResult.status === 'failure' ? nameResult.error?.message : undefined,
                symbolError: symbolResult.status === 'failure' ? symbolResult.error?.message : undefined,
            });
            return {
                status: 'invalid' as const,
                name: '',
                symbol: '',
                decimals: 0,
            };
        }

        context.log.info('Got token details', {
            tokenAddress: tokenAddressStr,
            name: nameResult.result,
            symbol: symbolResult.result,
            decimals: decimalsResult.result,
        });

        return {
            status: 'ok' as const,
            name: nameResult.result,
            symbol: symbolResult.result,
            decimals: decimalsResult.result,
        };
    }
);
