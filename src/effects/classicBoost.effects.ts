import { createEffect } from 'envio';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import { hexSchema } from '../lib/hex';
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
    },
    async ({ input, context }) => {
        const { boostAddress, chainId } = input;
        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClassicBoost tokens', { boostAddress, chainId });

        const [underlyingTokenResult, rewardTokenResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                {
                    address: boostAddress as `0x${string}`,
                    abi: classicBoostAbi,
                    functionName: 'stakedToken',
                    args: [],
                },
                {
                    address: boostAddress as `0x${string}`,
                    abi: classicBoostAbi,
                    functionName: 'rewardToken',
                    args: [],
                },
            ],
        });

        // The boost contract itself is the share token (virtual token)
        const shareTokenAddress = boostAddress;

        if (underlyingTokenResult.status === 'failure') {
            context.log.error('ClassicBoost stakedToken call failed', { boostAddress, chainId });
            return {
                shareTokenAddress,
                stakedTokenAddress: ADDRESS_ZERO,
                rewardTokenAddress: ADDRESS_ZERO,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        const stakedTokenAddress = underlyingTokenResult.result;
        const rewardTokenAddress = rewardTokenResult.status === 'success' ? rewardTokenResult.result : ADDRESS_ZERO;

        context.log.info('ClassicBoost data fetched', {
            boostAddress,
            shareTokenAddress,
            stakedTokenAddress,
            rewardTokenAddress,
        });

        if (stakedTokenAddress === ADDRESS_ZERO) {
            return {
                shareTokenAddress,
                stakedTokenAddress,
                rewardTokenAddress,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress,
            stakedTokenAddress,
            rewardTokenAddress,
            blacklistStatus: 'ok' as const,
        };
    }
);
