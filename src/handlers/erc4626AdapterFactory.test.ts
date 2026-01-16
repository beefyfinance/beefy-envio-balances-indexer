import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('Erc4626AdapterFactory Handlers', () => {
    describe('Erc4626AdapterCreated event', () => {
        it.skip('Should register Erc4626Adapter when Erc4626AdapterCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 13521369, endBlock: 13521369 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should add Erc4626Adapter to context when Erc4626AdapterCreated event is emitted'
            ).toMatchInlineSnapshot();
        });
    });
});
