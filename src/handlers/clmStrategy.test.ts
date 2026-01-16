import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClmStrategy Handlers', () => {
    describe('Initialized event', () => {
        it.skip('Should create ClmStrategy entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 15683455, endBlock: 15683455 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should create ClmStrategy entity linked to existing ClmManager').toMatchInlineSnapshot();
        });

        it.skip('Should handle already initialized ClmStrategy gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 15684045, endBlock: 15684045 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when ClmStrategy is already initialized'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should skip ClmStrategy with zero address manager', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 15684045, endBlock: 15684045 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should return null and log error when manager address is zero').toMatchInlineSnapshot();
        });

        it.skip('Should skip ClmStrategy when parent ClmManager does not exist', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 15684045, endBlock: 15684045 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log warning when ClmManager parent entity does not exist'
            ).toMatchInlineSnapshot();
        });
    });
});
