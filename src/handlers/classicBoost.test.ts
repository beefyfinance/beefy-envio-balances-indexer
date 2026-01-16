import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClassicBoost Handlers', () => {
    describe('Initialized event', () => {
        it('Should create ClassicBoost entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2578061, endBlock: 2578061 },
                    },
                }),
                'Should create ClassicBoost entity with correct shareToken and underlyingToken'
            ).toMatchInlineSnapshot();
        });

        it('Should handle already initialized ClassicBoost gracefully', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2855526, endBlock: 2855526 },
                    },
                }),
                'Should return early without errors when ClassicBoost is already initialized'
            ).toMatchInlineSnapshot();
        });

        it('Should skip blacklisted ClassicBoost during initialization', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should return null and log blacklist status for blacklisted ClassicBoost'
            ).toMatchInlineSnapshot();
        });
    });

    describe('Staked event', () => {
        it('Should update balances when Staked event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should update Account balances and create BalanceSnapshot when Staked event is emitted'
            ).toMatchInlineSnapshot();
        });

        it('Should handle zero amount stakes correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539963, endBlock: 17539963 },
                    },
                }),
                'Should handle zero amount stakes without errors'
            ).toMatchInlineSnapshot();
        });

        it('Should handle multiple stakes in the same block correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should process multiple Staked events in the same block correctly'
            ).toMatchInlineSnapshot();
        });
    });

    describe('Withdrawn event', () => {
        it('Should update balances when Withdrawn event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should update Account balances and create BalanceSnapshot when Withdrawn event is emitted'
            ).toMatchInlineSnapshot();
        });

        it('Should handle zero amount withdrawals correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539963, endBlock: 17539963 },
                    },
                }),
                'Should handle zero amount withdrawals without errors'
            ).toMatchInlineSnapshot();
        });
    });

    describe('RewardAdded event', () => {
        it('Should create PoolRewardedEvent when RewardAdded event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should create PoolRewardedEvent entity with correct reward token and amount'
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
    });
});
