import { createEffect, type EvmChainId, S } from 'envio';
import { erc20Abi } from 'viem';

import { asHex } from '../lib/hex';
import { getViemClient } from '../lib/viem';

/**
 * ERC-20 metadata, once per token (chain-scoped cache keyed on the lowercase address), read at `latest`:
 * decimals / name / symbol do not change. On-chain reverts return `invalid` (cached); transport errors throw.
 */
export const getTokenMetadata = createEffect(
    {
        name: 'getTokenMetadata',
        input: { address: S.string },
        output: S.schema({
            status: S.union(['ok', 'invalid']),
            name: S.optional(S.string),
            symbol: S.optional(S.string),
            decimals: S.optional(S.number),
        }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const address = asHex(input.address);
        const client = getViemClient(context.chain.id as EvmChainId, context.log);
        const erc20 = { address, abi: erc20Abi } as const;
        const [decimals, name, symbol] = await client.multicall({
            allowFailure: true,
            contracts: [
                { ...erc20, functionName: 'decimals', args: [] },
                { ...erc20, functionName: 'name', args: [] },
                { ...erc20, functionName: 'symbol', args: [] },
            ],
        });
        const ok = decimals.status === 'success' && name.status === 'success' && symbol.status === 'success';
        if (!ok) {
            context.log.warn('[INVALID_TOKEN] token metadata calls reverted', {
                address,
                decimals: decimals.status,
                name: name.status,
                symbol: symbol.status,
            });
        }
        return {
            status: ok ? ('ok' as const) : ('invalid' as const),
            decimals: decimals.status === 'success' ? decimals.result : undefined,
            name: name.status === 'success' ? name.result : undefined,
            symbol: symbol.status === 'success' ? symbol.result : undefined,
        };
    }
);
