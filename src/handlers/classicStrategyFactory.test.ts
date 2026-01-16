import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClassicStrategyFactory Handlers', () => {
    describe('StrategyCreated event', () => {
        it('Should register ClassicStrategy when StrategyCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 10003201, endBlock: 10003201 },
                    },
                }),
                'Should add ClassicStrategy to context when StrategyCreated event is emitted'
            ).toMatchInlineSnapshot();
        });
    });
});
