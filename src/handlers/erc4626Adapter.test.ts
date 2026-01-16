import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('Erc4626Adapter Handlers', () => {
    describe('Initialized event', () => {
        it('Should create Erc4626Adapter entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 13521369, endBlock: 13521369 },
                    },
                }),
                'Should create Erc4626Adapter entity with correct shareToken and underlyingToken'
            ).toMatchInlineSnapshot();
        });

        it('Should handle already initialized Erc4626Adapter gracefully', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 13522734, endBlock: 13522734 },
                    },
                }),
                'Should return early without errors when Erc4626Adapter is already initialized'
            ).toMatchInlineSnapshot();
        });

        it('Should skip blacklisted Erc4626Adapter during initialization', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should return null and log blacklist status for blacklisted Erc4626Adapter'
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
                        8453: { startBlock: 17539963, endBlock: 17539963 },
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
                        8453: { startBlock: 17539954, endBlock: 17539954 },
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

        it('Should handle multiple transfers in the same block correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should process multiple Transfer events in the same block correctly'
            ).toMatchInlineSnapshot();
        });
    });
});
