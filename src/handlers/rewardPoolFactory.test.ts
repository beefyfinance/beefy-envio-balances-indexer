import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('RewardPoolFactory Handlers', () => {
    describe('RewardPoolCreated event', () => {
        it.skip('Should register RewardPool when RewardPoolCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 16538679, endBlock: 16538679 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should add RewardPool to context when RewardPoolCreated event is emitted'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should skip blacklisted proxy addresses', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 13014756, endBlock: 13014756 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should not register blacklisted proxy addresses').toMatchInlineSnapshot();
        });
    });

    describe('RewardPoolCreatedWithName event', () => {
        it.skip('Should register RewardPool when RewardPoolCreatedWithName event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 13014756, endBlock: 13014756 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should add RewardPool to context when RewardPoolCreatedWithName event is emitted'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should skip blacklisted proxy addresses', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 13014756, endBlock: 13014756 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should not register blacklisted proxy addresses').toMatchInlineSnapshot();
        });
    });
});
