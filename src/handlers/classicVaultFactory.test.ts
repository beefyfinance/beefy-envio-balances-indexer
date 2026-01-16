import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClassicVaultFactory Handlers', () => {
    describe('VaultOrStrategyCreated event', () => {
        it('Should register ClassicVault when VaultOrStrategyCreated event detects a vault', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2189005, endBlock: 2189005 },
                    },
                }),
                'Should add ClassicVault to context when vault is detected from VaultOrStrategyCreated event'
            ).toMatchInlineSnapshot();
        });

        it('Should register ClassicBoost when VaultOrStrategyCreated event detects a boost', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2189005, endBlock: 2189005 },
                    },
                }),
                'Should add ClassicBoost to context when boost is detected from VaultOrStrategyCreated event'
            ).toMatchInlineSnapshot();
        });

        it('Should skip strategy when VaultOrStrategyCreated event detects a strategy', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2189005, endBlock: 2189005 },
                    },
                }),
                'Should log and ignore strategy when detected from VaultOrStrategyCreated event'
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
