import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClmManagerFactory Handlers', () => {
    describe('ClmManagerCreated event', () => {
        it('Should register ClmManager when ClmManagerCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 15682120, endBlock: 15682120 },
                    },
                }),
                'Should add ClmManager to context when ClmManagerCreated event is emitted'
            ).toMatchInlineSnapshot();
        });

        it('Should skip blacklisted proxy addresses', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 13014756, endBlock: 13014756 },
                    },
                }),
                'Should not register blacklisted proxy addresses'
            ).toMatchInlineSnapshot();
        });
    });
});
