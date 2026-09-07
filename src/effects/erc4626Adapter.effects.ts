import { createEffect } from 'envio';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { decodeEffectInput } from '../lib/effect';
import { asHex, hexSchema, toHex, ZERO_ADDRESS_HEX } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { erc4626AdapterAbi } from './abis/beefy/common/Erc4626Adapter';

export const getErc4626AdapterTokens = createEffect(
    {
        name: 'getErc4626AdapterTokens',
        input: {
            adapterAddress: hexSchema,
            chainId: chainIdSchema,
        },
        output: {
            shareTokenAddress: hexSchema,
            underlyingTokenAddress: hexSchema,
            blacklistStatus: blacklistStatus,
        },
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const { adapterAddress, chainId } = decodeEffectInput(input);
        const adapterAddressStr = toHex(adapterAddress);
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching Erc4626Adapter tokens', { adapterAddress: adapterAddressStr, chainId });

        const [underlyingTokenResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: adapterAddressStr,
                    abi: erc4626AdapterAbi,
                    functionName: 'asset',
                    args: [],
                },
            ],
        });

        if (underlyingTokenResult.status === 'failure') {
            context.log.error('Erc4626Adapter asset call failed', { adapterAddress: adapterAddressStr, chainId });
            return {
                shareTokenAddress: adapterAddressStr,
                underlyingTokenAddress: ZERO_ADDRESS_HEX,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        const underlyingTokenAddressStr = asHex(underlyingTokenResult.result);

        context.log.info('Erc4626Adapter data fetched', {
            adapterAddress: adapterAddressStr,
            shareTokenAddress: adapterAddressStr,
            underlyingTokenAddress: underlyingTokenAddressStr,
        });

        if (underlyingTokenAddressStr === ZERO_ADDRESS_HEX) {
            return {
                shareTokenAddress: adapterAddressStr,
                underlyingTokenAddress: underlyingTokenAddressStr,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress: adapterAddressStr,
            underlyingTokenAddress: underlyingTokenAddressStr,
            blacklistStatus: 'ok' as const,
        };
    }
);
