import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClmManagerFactory Handlers', () => {
    describe('ClmManagerCreated event', () => {
        it.skip('Should register ClmManager when ClmManagerCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 15682120, endBlock: 15682120 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should add ClmManager to context when ClmManagerCreated event is emitted'
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
