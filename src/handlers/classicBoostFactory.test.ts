import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClassicBoostFactory Handlers', () => {
    describe('BoostCreated event', () => {
        it('Should register ClassicBoost when BoostCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2578061, endBlock: 2578061 },
                    },
                }),
                'Should add ClassicBoost to context when BoostCreated event is emitted'
            ).toMatchInlineSnapshot();
        });
    });

    describe('BoostDeployed event', () => {
        it('Should register ClassicBoost when BoostDeployed event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2578061, endBlock: 2578061 },
                    },
                }),
                'Should add ClassicBoost to context when BoostDeployed event is emitted'
            ).toMatchInlineSnapshot();
        });
    });
});
