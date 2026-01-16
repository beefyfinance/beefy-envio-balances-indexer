import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('ContractFactory Handlers', () => {
    describe('ContractDeployed event', () => {
        it('Should log ContractDeployed event when ContractDeployed event is emitted', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        8453: { startBlock: 2189005, endBlock: 2189005 },
                    },
                }),
                'Should log ContractDeployed event information'
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
                'Should not process blacklisted proxy addresses'
            ).toMatchInlineSnapshot();
        });
    });
});
