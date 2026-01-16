import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('RewardPool Handlers', () => {
    describe('Initialized event', () => {
        it.skip('Should create RewardPool entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 16538679, endBlock: 16538679 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create RewardPool entity with correct shareToken and underlyingToken'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should handle already initialized RewardPool gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 16538689, endBlock: 16538689 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when RewardPool is already initialized'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should skip blacklisted RewardPool during initialization', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log blacklist status for blacklisted RewardPool'
            ).toMatchInlineSnapshot();
        });
    });

    describe('Transfer event', () => {
        it.skip('Should update balances when Transfer event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should update Account balances and create BalanceSnapshot when Transfer event is emitted'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should handle zero value transfers correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539963, endBlock: 17539963 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should handle zero value transfers without errors').toMatchInlineSnapshot();
        });

        it.skip('Should handle mint transfers (from zero address) correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should correctly handle mint transfers from zero address').toMatchInlineSnapshot();
        });

        it.skip('Should handle burn transfers (to zero address) correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should correctly handle burn transfers to zero address').toMatchInlineSnapshot();
        });

        it.skip('Should handle multiple transfers in the same block correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should process multiple Transfer events in the same block correctly'
            ).toMatchInlineSnapshot();
        });
    });

    describe('NotifyReward event', () => {
        it.skip('Should create PoolRewardedEvent when NotifyReward event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create PoolRewardedEvent entity with correct reward token, amount, and vesting duration'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should handle zero reward amounts correctly', async () => {
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

        it.skip('Should handle multiple NotifyReward events in the same block correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should process multiple NotifyReward events in the same block correctly'
            ).toMatchInlineSnapshot();
        });
    });
});
