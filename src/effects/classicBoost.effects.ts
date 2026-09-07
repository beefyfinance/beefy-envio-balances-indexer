import { createEffect } from 'envio';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { decodeEffectInput } from '../lib/effect';
import { asHex, hexSchema, toHex, ZERO_ADDRESS_HEX } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { classicBoostAbi } from './abis/beefy/classic/ClassicBoost';

export const getClassicBoostTokens = createEffect(
    {
        name: 'getClassicBoostTokens',
        input: {
            boostAddress: hexSchema,
            chainId: chainIdSchema,
        },
        output: {
            shareTokenAddress: hexSchema,
            stakedTokenAddress: hexSchema,
            rewardTokenAddress: hexSchema,
            blacklistStatus: blacklistStatus,
        },
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const { boostAddress, chainId } = decodeEffectInput(input);
        const boostAddressStr = toHex(boostAddress);
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClassicBoost tokens', { boostAddress: boostAddressStr, chainId });

        const [underlyingTokenResult, rewardTokenResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: boostAddressStr,
                    abi: classicBoostAbi,
                    functionName: 'stakedToken',
                    args: [],
                },
                {
                    address: boostAddressStr,
                    abi: classicBoostAbi,
                    functionName: 'rewardToken',
                    args: [],
                },
            ],
        });

        if (underlyingTokenResult.status === 'failure') {
            context.log.error('ClassicBoost stakedToken call failed', { boostAddress: boostAddressStr, chainId });
            return {
                shareTokenAddress: boostAddressStr,
                stakedTokenAddress: ZERO_ADDRESS_HEX,
                rewardTokenAddress: ZERO_ADDRESS_HEX,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        const stakedTokenAddressStr = asHex(underlyingTokenResult.result);
        const rewardTokenAddressStr =
            rewardTokenResult.status === 'success' ? asHex(rewardTokenResult.result) : ZERO_ADDRESS_HEX;

        context.log.info('ClassicBoost data fetched', {
            boostAddress: boostAddressStr,
            shareTokenAddress: boostAddressStr,
            stakedTokenAddress: stakedTokenAddressStr,
            rewardTokenAddress: rewardTokenAddressStr,
        });

        if (stakedTokenAddressStr === ZERO_ADDRESS_HEX) {
            return {
                shareTokenAddress: boostAddressStr,
                stakedTokenAddress: stakedTokenAddressStr,
                rewardTokenAddress: rewardTokenAddressStr,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress: boostAddressStr,
            stakedTokenAddress: stakedTokenAddressStr,
            rewardTokenAddress: rewardTokenAddressStr,
            blacklistStatus: 'ok' as const,
        };
    }
);
