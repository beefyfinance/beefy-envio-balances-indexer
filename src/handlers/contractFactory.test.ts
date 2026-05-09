import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

describe('ContractFactory Handlers', () => {
    describe('ContractDeployed event', () => {
        it('Should log ContractDeployed event when ContractDeployed event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ContractFactory',
                                event: 'ContractDeployed',
                                block: { number: 2189005, timestamp: 1715372800 },
                                logIndex: 2,
                                srcAddress: '0x1111111111111111111111111111111111111111',
                                params: {
                                    contractName: '0x4249464900000000000000000000000000000000000000000000000000000000',
                                    proxy: '0x00000000000000000000000000000000cafebabe',
                                },
                            },
                        ],
                    },
                },
            });

            expect(trace).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 2189005,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should skip blacklisted proxy addresses', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ContractFactory',
                                event: 'ContractDeployed',
                                block: { number: 13014756, timestamp: 1720000000 },
                                logIndex: 0,
                                srcAddress: '0x1111111111111111111111111111111111111111',
                                params: {
                                    contractName: '0x0000000000000000000000000000000000000000000000000000000000000001',
                                    proxy: '0x0a1bbea11423f0cd2c247a9ad2ae6bd06aebc60d',
                                },
                            },
                        ],
                    },
                },
            });

            expect(trace).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 13014756,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
