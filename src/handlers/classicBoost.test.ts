import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClassicBoost Handlers', () => {
    describe('Initialized event', () => {
        it.skip('Should create ClassicBoost entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 2578061, endBlock: 2578061 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create ClassicBoost entity with correct shareToken and underlyingToken'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should handle already initialized ClassicBoost gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 2855526, endBlock: 2855526 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when ClassicBoost is already initialized'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should skip blacklisted ClassicBoost during initialization', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log blacklist status for blacklisted ClassicBoost'
            ).toMatchInlineSnapshot();
        });
    });

    describe('Staked event', () => {
        it.skip('Should update balances when Staked event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should update Account balances and create BalanceSnapshot when Staked event is emitted'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should handle zero amount stakes correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539963, endBlock: 17539963 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should handle zero amount stakes without errors').toMatchInlineSnapshot();
        });

        it.skip('Should handle multiple stakes in the same block correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should process multiple Staked events in the same block correctly').toMatchInlineSnapshot();
        });
    });

    describe('Withdrawn event', () => {
        it.skip('Should update balances when Withdrawn event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should update Account balances and create BalanceSnapshot when Withdrawn event is emitted'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should handle zero amount withdrawals correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539963, endBlock: 17539963 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should handle zero amount withdrawals without errors').toMatchInlineSnapshot();
        });
    });

    describe('RewardAdded event', () => {
        it.skip('Should create PoolRewardedEvent when RewardAdded event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539954, endBlock: 17539954 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create PoolRewardedEvent entity with correct reward token and amount'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should handle zero reward amounts correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 17539963, endBlock: 17539963 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should handle zero reward amounts without errors').toMatchInlineSnapshot();
        });
    });
});
