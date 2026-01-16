import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClassicStrategy Handlers', () => {
    describe('Initialized event', () => {
        it('Should create ClassicVaultStrategy entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 10003201, endBlock: 10003201 },
                    },
                }),
                'Should create ClassicVaultStrategy entity linked to existing ClassicVault'
            ).toMatchInlineSnapshot();
        });

        it('Should handle already initialized ClassicStrategy gracefully', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2190000, endBlock: 2190000 },
                    },
                }),
                'Should return early without errors when ClassicStrategy is already initialized'
            ).toMatchInlineSnapshot();
        });

        it('Should skip ClassicStrategy with zero address vault', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 10306461, endBlock: 10306461 },
                    },
                }),
                'Should return null and log error when vault address is zero'
            ).toMatchInlineSnapshot();
        });

        it('Should skip ClassicStrategy when parent ClassicVault does not exist', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 10306461, endBlock: 10306461 },
                    },
                }),
                'Should return null and log warning when ClassicVault parent entity does not exist'
            ).toMatchInlineSnapshot();
        });
    });
});
