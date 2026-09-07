import { createEffect } from 'envio';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { decodeEffectInput } from '../lib/effect';
import { asHex, hexSchema, toHex, ZERO_ADDRESS_HEX } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { rewardPoolAbi } from './abis/beefy/common/RewardPool';

export const getRewardPoolTokens = createEffect(
    {
        name: 'getRewardPoolTokens',
        input: {
            rewardPoolAddress: hexSchema,
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
        const { rewardPoolAddress, chainId } = decodeEffectInput(input);
        const rewardPoolAddressStr = toHex(rewardPoolAddress);
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching RewardPool tokens', { rewardPoolAddress: rewardPoolAddressStr, chainId });

        const [underlyingTokenResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: rewardPoolAddressStr,
                    abi: rewardPoolAbi,
                    functionName: 'stakedToken',
                    args: [],
                },
            ],
        });

        if (underlyingTokenResult.status === 'failure') {
            context.log.error('RewardPool stakedToken call failed', {
                rewardPoolAddress: rewardPoolAddressStr,
                chainId,
            });
            return {
                shareTokenAddress: rewardPoolAddressStr,
                underlyingTokenAddress: ZERO_ADDRESS_HEX,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        const underlyingTokenAddressStr = asHex(underlyingTokenResult.result);

        context.log.info('RewardPool data fetched', {
            rewardPoolAddress: rewardPoolAddressStr,
            shareTokenAddress: rewardPoolAddressStr,
            underlyingTokenAddress: underlyingTokenAddressStr,
        });

        if (underlyingTokenAddressStr === ZERO_ADDRESS_HEX) {
            return {
                shareTokenAddress: rewardPoolAddressStr,
                underlyingTokenAddress: underlyingTokenAddressStr,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress: rewardPoolAddressStr,
            underlyingTokenAddress: underlyingTokenAddressStr,
            blacklistStatus: 'ok' as const,
        };
    }
);
