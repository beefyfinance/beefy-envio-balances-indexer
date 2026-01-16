import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClassicBoostFactory Handlers', () => {
    describe('BoostCreated event', () => {
        it.skip('Should register ClassicBoost when BoostCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 2578061, endBlock: 2578061 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should add ClassicBoost to context when BoostCreated event is emitted'
            ).toMatchInlineSnapshot();
        });
    });

    describe('BoostDeployed event', () => {
        it.skip('Should register ClassicBoost when BoostDeployed event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 2578061, endBlock: 2578061 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should add ClassicBoost to context when BoostDeployed event is emitted'
            ).toMatchInlineSnapshot();
        });
    });
});
