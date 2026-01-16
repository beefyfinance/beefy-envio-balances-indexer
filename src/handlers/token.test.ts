import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('Token Handlers', () => {
    describe('Initialized event', () => {
        it('Should create Token entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2189005, endBlock: 2189005 },
                    },
                }),
                'Should create Token entity with correct address and chainId'
            ).toMatchInlineSnapshot();
        });

        it('Should handle already initialized Token gracefully', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2190124, endBlock: 2190124 },
                    },
                }),
                'Should return early without errors when Token is already initialized'
            ).toMatchInlineSnapshot();
        });
    });

    describe('Transfer event', () => {
        it('Should update balances when Transfer event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should update Account balances and create BalanceSnapshot when Transfer event is emitted'
            ).toMatchInlineSnapshot();
        });

        it('Should handle zero value transfers correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 13000047, endBlock: 13000047 },
                    },
                }),
                'Should handle zero value transfers without errors'
            ).toMatchInlineSnapshot();
        });

        it('Should handle mint transfers (from zero address) correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539963, endBlock: 17539963 },
                    },
                }),
                'Should correctly handle mint transfers from zero address'
            ).toMatchInlineSnapshot();
        });

        it('Should handle burn transfers (to zero address) correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should correctly handle burn transfers to zero address'
            ).toMatchInlineSnapshot();
        });

        it('Should handle large value transfers correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 13014756, endBlock: 13014756 },
                    },
                }),
                'Should correctly handle transfers with very large values'
            ).toMatchInlineSnapshot();
        });

        it('Should handle multiple transfers in the same block correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 13014756, endBlock: 13014756 },
                    },
                }),
                'Should process multiple Transfer events in the same block correctly'
            ).toMatchInlineSnapshot();
        });
    });
});
