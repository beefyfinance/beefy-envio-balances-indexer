import { onBlock } from 'generated';
import { keccak256, toHex } from 'viem';
import { getBlockTimestamp } from '../effects/block.effects';
import { allChainIds, toChainId } from '../lib/chain';
import { getBlockTimeMs } from '../lib/viem';

// Snapshot period constants (seconds), matching cowcentrated time.ts
const DAY = 86400;
const WEEK = 604800;

const SNAPSHOT_PERIODS = [DAY, WEEK] as const;
const SNAPSHOT_TIME_INTERVAL_MS = 60 * 60 * 1000; // hourly

function getIntervalFromTimestamp(timestampSeconds: number, periodSeconds: number): number {
    return Math.floor(timestampSeconds / periodSeconds) * periodSeconds;
}

function tokenBalanceSnapshotId(tokenBalanceId: string, period: number, roundedTimestamp: number): string {
    return keccak256(toHex(`${tokenBalanceId}-${period}-${roundedTimestamp}`), 'hex');
}

for (const chainId of allChainIds) {
    const blockTimeMs = getBlockTimeMs(chainId);
    const intervalBlocks = Math.max(1, Math.floor(SNAPSHOT_TIME_INTERVAL_MS / blockTimeMs));

    onBlock(
        {
            name: 'TokenBalanceSnapshot',
            chain: chainId,
            interval: intervalBlocks,
        },
        async ({ block, context }) => {
            const chainIdNum = toChainId(context.chain.id);
            const blockNumber = block.number;
            const { timestamp: timestampSeconds } = await context.effect(getBlockTimestamp, {
                chainId: chainIdNum,
                blockNumber,
            });
            const timestampDate = new Date(timestampSeconds * 1000);

            const balances = await context.TokenBalance.getWhere.chainId.eq(chainIdNum);

            const [classicVaults, classicBoosts, erc4626Adapters, clmManagers, rewardPools, lstVaults] =
                await Promise.all([
                    context.ClassicVault.getWhere.chainId.eq(chainIdNum),
                    context.ClassicBoost.getWhere.chainId.eq(chainIdNum),
                    context.Erc4626Adapter.getWhere.chainId.eq(chainIdNum),
                    context.ClmManager.getWhere.chainId.eq(chainIdNum),
                    context.RewardPool.getWhere.chainId.eq(chainIdNum),
                    context.LstVault.getWhere.chainId.eq(chainIdNum),
                ]);
            const shareTokenIds = new Set([
                ...classicVaults.map((v) => v.shareToken_id),
                ...classicBoosts.map((v) => v.shareToken_id),
                ...erc4626Adapters.map((v) => v.shareToken_id),
                ...clmManagers.map((v) => v.shareToken_id),
                ...rewardPools.map((v) => v.shareToken_id),
                ...lstVaults.map((v) => v.shareToken_id),
            ]);

            for (const balance of balances) {
                if (!shareTokenIds.has(balance.token_id)) continue;
                for (const period of SNAPSHOT_PERIODS) {
                    const roundedTimestamp = getIntervalFromTimestamp(timestampSeconds, period);
                    const snapshotId = tokenBalanceSnapshotId(balance.id, period, roundedTimestamp);

                    const snapshot = await context.TokenBalanceSnapshot.getOrCreate({
                        id: snapshotId,
                        chainId: chainIdNum,
                        account_id: balance.account_id,
                        token_id: balance.token_id,
                        period: BigInt(period),
                        roundedTimestamp: BigInt(roundedTimestamp),
                        timestamp: timestampDate,
                        blockNumber: BigInt(blockNumber),
                        amount: balance.amount,
                    });
                    context.TokenBalanceSnapshot.set({
                        ...snapshot,
                        timestamp: timestampDate,
                        blockNumber: BigInt(blockNumber),
                        amount: balance.amount,
                    });
                }
            }
        }
    );
}
