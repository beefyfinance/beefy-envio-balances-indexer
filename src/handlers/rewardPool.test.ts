import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('RewardPool Handlers', () => {
    describe('Initialized event', () => {
        it('Should create RewardPool entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 16538679, endBlock: 16538679 },
                    },
                }),
                'Should create RewardPool entity with correct shareToken and underlyingToken'
            ).toMatchInlineSnapshot();
        });

        it('Should handle already initialized RewardPool gracefully', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 16538689, endBlock: 16538689 },
                    },
                }),
                'Should return early without errors when RewardPool is already initialized'
            ).toMatchInlineSnapshot();
        });

        it('Should skip blacklisted RewardPool during initialization', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should return null and log blacklist status for blacklisted RewardPool'
            ).toMatchInlineSnapshot();
        });
    });

    describe('Transfer event', () => {
        it('Should update balances when Transfer event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should update Account balances and create BalanceSnapshot when Transfer event is emitted'
            ).toMatchInlineSnapshot();
        });

        it('Should handle zero value transfers correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539963, endBlock: 17539963 },
                    },
                }),
                'Should handle zero value transfers without errors'
            ).toMatchInlineSnapshot();
        });

        it('Should handle mint transfers (from zero address) correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should correctly handle mint transfers from zero address'
            ).toMatchInlineSnapshot();
        });

        it('Should handle burn transfers (to zero address) correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should correctly handle burn transfers to zero address'
            ).toMatchInlineSnapshot();
        });

        it('Should handle multiple transfers in the same block correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should process multiple Transfer events in the same block correctly'
            ).toMatchInlineSnapshot();
        });
    });

    describe('NotifyReward event', () => {
        it('Should create PoolRewardedEvent when NotifyReward event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should create PoolRewardedEvent entity with correct reward token, amount, and vesting duration'
            ).toMatchInlineSnapshot();
        });

        it('Should handle zero reward amounts correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539963, endBlock: 17539963 },
                    },
                }),
                'Should handle zero reward amounts without errors'
            ).toMatchInlineSnapshot();
        });

        it('Should handle multiple NotifyReward events in the same block correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should process multiple NotifyReward events in the same block correctly'
            ).toMatchInlineSnapshot();
        });
    });
});
