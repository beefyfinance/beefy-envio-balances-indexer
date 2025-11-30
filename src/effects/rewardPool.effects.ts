import { createEffect } from 'envio';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import { hexSchema } from '../lib/hex';
import { getViemClient } from '../lib/viem';

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
    },
    async ({ input, context }) => {
        const { rewardPoolAddress, chainId } = input;
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching RewardPool tokens', { rewardPoolAddress, chainId });

        const [underlyingTokenResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: rewardPoolAddress as `0x${string}`,
                    abi: [
                        {
                            inputs: [],
                            name: 'stakedToken',
                            outputs: [{ name: '', type: 'address' }],
                            stateMutability: 'view',
                            type: 'function',
                        },
                    ],
                    functionName: 'stakedToken',
                    args: [],
                },
            ],
        });

        // The reward pool contract itself is the share token (virtual token)
        const shareTokenAddress = rewardPoolAddress;

        if (underlyingTokenResult.status === 'failure') {
            context.log.error('RewardPool stakedToken call failed', { rewardPoolAddress, chainId });
            return {
                shareTokenAddress,
                underlyingTokenAddress: ADDRESS_ZERO,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        const underlyingTokenAddress = underlyingTokenResult.result;

        context.log.info('RewardPool data fetched', { rewardPoolAddress, shareTokenAddress, underlyingTokenAddress });

        if (underlyingTokenAddress === ADDRESS_ZERO) {
            return {
                shareTokenAddress,
                underlyingTokenAddress,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress,
            underlyingTokenAddress,
            blacklistStatus: 'ok' as const,
        };
    }
);
