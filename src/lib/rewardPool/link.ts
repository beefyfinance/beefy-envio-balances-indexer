import type { Classic, Clm, EvmChainId, EvmOnEventContext, RewardPool } from 'envio';
import type { Hex } from 'viem';
import { getClassic, linkClassicRewardPool } from '../../entities/classic.entity';
import { getClm, linkClmRewardPool } from '../../entities/clm.entity';
import { getTokenOrThrow } from '../../entities/token.entity';
import { isClassicVaultStakedToken } from '../classic/init';
import { PLATFORM_BEEFY_CLM, PLATFORM_BEEFY_CLM_VAULT } from '../classic/platform/index';
import { loadClassicTokens } from '../classic/tokens';
import { isClmManagerRewardPool } from '../clm/init';
import { normalizeHex } from '../hex';

export const resolveClmForClassic = async ({
    context,
    chainId,
    classic,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
}): Promise<Clm | null> => {
    if (classic.underlyingPlatform !== PLATFORM_BEEFY_CLM && classic.underlyingPlatform !== PLATFORM_BEEFY_CLM_VAULT) {
        return null;
    }

    const tokens = await loadClassicTokens({ context, classic });
    const candidateAddresses: Hex[] = [normalizeHex(tokens.underlyingToken.address)];

    for (const rewardPoolToken of tokens.rewardPoolTokens) {
        candidateAddresses.push(normalizeHex(rewardPoolToken.address));
    }

    for (const address of candidateAddresses) {
        const clm = await getClm(context, chainId, address);
        if (clm) {
            return clm;
        }
    }

    return null;
};

export const maybeLinkRewardPoolProducts = async ({
    context,
    chainId,
    rewardPool,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    rewardPool: RewardPool;
}): Promise<RewardPool> => {
    const underlyingToken = await getTokenOrThrow({ context, id: rewardPool.underlyingToken_id });
    const stakedTokenAddress = normalizeHex(underlyingToken.address);
    const shareToken = await getTokenOrThrow({ context, id: rewardPool.shareToken_id });

    let classic_id = rewardPool.classic_id;
    let clm_id = rewardPool.clm_id;

    if (await isClmManagerRewardPool({ context, chainId, stakedTokenAddress })) {
        const clm = await getClm(context, chainId, stakedTokenAddress);
        if (clm && !clm_id) {
            await linkClmRewardPool({ context, clm, rewardPoolShareToken: shareToken });
            clm_id = clm.id;
        }
    } else if (await isClassicVaultStakedToken({ context, chainId, stakedTokenAddress })) {
        const classic = await getClassic(context, chainId, stakedTokenAddress);
        if (classic) {
            if (!classic_id) {
                await linkClassicRewardPool({ context, classic, rewardPoolShareToken: shareToken });
                classic_id = classic.id;
            }

            if (!clm_id) {
                const clm = await resolveClmForClassic({ context, chainId, classic });
                if (clm) {
                    await linkClmRewardPool({ context, clm, rewardPoolShareToken: shareToken });
                    clm_id = clm.id;
                }
            }
        }
    }

    if (classic_id === rewardPool.classic_id && clm_id === rewardPool.clm_id) {
        return rewardPool;
    }

    const updated = { ...rewardPool, classic_id, clm_id };
    context.RewardPool.set(updated);
    return updated;
};
