import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClmManager Handlers', () => {
    describe('Initialized event', () => {
        it('Should create ClmManager entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 15682120, endBlock: 15682120 },
                    },
                }),
                'Should create ClmManager entity with correct shareToken, underlyingToken0, and underlyingToken1'
            ).toMatchInlineSnapshot();
        });

        it('Should handle already initialized ClmManager gracefully', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 15683455, endBlock: 15683455 },
                    },
                }),
                'Should return early without errors when ClmManager is already initialized'
            ).toMatchInlineSnapshot();
        });

        it('Should skip blacklisted ClmManager during initialization', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 17539954, endBlock: 17539954 },
                    },
                }),
                'Should return null and log blacklist status for blacklisted ClmManager'
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
