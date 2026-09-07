import { createEffect } from 'envio';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { decodeEffectInput } from '../lib/effect';
import { asHex, hexSchema, toHex, ZERO_ADDRESS_HEX } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { clmManagerAbi } from './abis/beefy/clm/ClmManager';

export const getClmManagerTokens = createEffect(
    {
        name: 'getClmManagerTokens',
        input: {
            managerAddress: hexSchema,
            chainId: chainIdSchema,
        },
        output: {
            shareTokenAddress: hexSchema,
            underlyingToken0Address: hexSchema,
            underlyingToken1Address: hexSchema,
            blacklistStatus: blacklistStatus,
        },
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const { managerAddress, chainId } = decodeEffectInput(input);
        const managerAddressStr = toHex(managerAddress);
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClmManager tokens', { managerAddress: managerAddressStr, chainId });

        const [wantsResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: managerAddressStr,
                    abi: clmManagerAbi,
                    functionName: 'wants',
                    args: [],
                },
            ],
        });

        if (wantsResult.status === 'failure') {
            context.log.error('ClmManager wants call failed', { managerAddress: managerAddressStr, chainId });
            return {
                shareTokenAddress: managerAddressStr,
                underlyingToken0Address: ZERO_ADDRESS_HEX,
                underlyingToken1Address: ZERO_ADDRESS_HEX,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        const [token0, token1] = wantsResult.result;
        const underlyingToken0AddressStr = asHex(token0);
        const underlyingToken1AddressStr = asHex(token1);

        context.log.info('ClmManager data fetched', {
            managerAddress: managerAddressStr,
            shareTokenAddress: managerAddressStr,
            underlyingToken0Address: underlyingToken0AddressStr,
            underlyingToken1Address: underlyingToken1AddressStr,
        });

        if (underlyingToken0AddressStr === ZERO_ADDRESS_HEX || underlyingToken1AddressStr === ZERO_ADDRESS_HEX) {
            return {
                shareTokenAddress: managerAddressStr,
                underlyingToken0Address: underlyingToken0AddressStr,
                underlyingToken1Address: underlyingToken1AddressStr,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress: managerAddressStr,
            underlyingToken0Address: underlyingToken0AddressStr,
            underlyingToken1Address: underlyingToken1AddressStr,
            blacklistStatus: 'ok' as const,
        };
    }
);
