import { createEffect } from 'envio';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { decodeEffectInput } from '../lib/effect';
import { asHex, hexSchema, toHex, ZERO_ADDRESS_HEX } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { lstVaultAbi } from './abis/beefy/lst/LstVault';

export const getLstVaultTokens = createEffect(
    {
        name: 'getLstVaultTokens',
        input: {
            lstAddress: hexSchema,
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
        const { lstAddress, chainId } = decodeEffectInput(input);
        const lstAddressStr = toHex(lstAddress);
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching LstVault tokens', { lstAddress: lstAddressStr, chainId });

        const [underlyingTokenResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: lstAddressStr,
                    abi: lstVaultAbi,
                    functionName: 'asset',
                    args: [],
                },
            ],
        });

        if (underlyingTokenResult.status === 'failure') {
            context.log.error('LstVault asset call failed', { lstAddress: lstAddressStr, chainId });
            return {
                shareTokenAddress: lstAddressStr,
                underlyingTokenAddress: ZERO_ADDRESS_HEX,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        const underlyingTokenAddressStr = asHex(underlyingTokenResult.result);

        context.log.info('LstVault data fetched', {
            lstAddress: lstAddressStr,
            shareTokenAddress: lstAddressStr,
            underlyingTokenAddress: underlyingTokenAddressStr,
        });

        if (underlyingTokenAddressStr === ZERO_ADDRESS_HEX) {
            return {
                shareTokenAddress: lstAddressStr,
                underlyingTokenAddress: underlyingTokenAddressStr,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress: lstAddressStr,
            underlyingTokenAddress: underlyingTokenAddressStr,
            blacklistStatus: 'ok' as const,
        };
    }
);
