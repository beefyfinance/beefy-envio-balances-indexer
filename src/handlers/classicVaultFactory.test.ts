import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ClassicVaultFactory Handlers', () => {
    describe('VaultOrStrategyCreated event', () => {
        it.skip('Should register ClassicVault when VaultOrStrategyCreated event detects a vault', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 2189005, endBlock: 2189005 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should add ClassicVault to context when vault is detected from VaultOrStrategyCreated event'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should register ClassicBoost when VaultOrStrategyCreated event detects a boost', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 2189005, endBlock: 2189005 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should add ClassicBoost to context when boost is detected from VaultOrStrategyCreated event'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should skip strategy when VaultOrStrategyCreated event detects a strategy', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 2189005, endBlock: 2189005 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should log and ignore strategy when detected from VaultOrStrategyCreated event'
            ).toMatchInlineSnapshot();
        });

        it.skip('Should skip blacklisted proxy addresses', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 13014756, endBlock: 13014756 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should not register blacklisted proxy addresses').toMatchInlineSnapshot();
        });
    });
});
