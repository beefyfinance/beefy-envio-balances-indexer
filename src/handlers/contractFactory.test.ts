import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ContractFactory Handlers', () => {
    describe('ContractDeployed event', () => {
        it.skip('Should log ContractDeployed event when ContractDeployed event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 2189005, endBlock: 2189005 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should log ContractDeployed event information').toMatchInlineSnapshot();
        });

        it.skip('Should skip blacklisted proxy addresses', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 13014756, endBlock: 13014756 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should not process blacklisted proxy addresses').toMatchInlineSnapshot();
        });
    });
});
