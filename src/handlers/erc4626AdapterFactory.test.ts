import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

describe('Erc4626AdapterFactory Handlers', () => {
    describe('Erc4626AdapterCreated event', () => {
        it('Should register Erc4626Adapter when Erc4626AdapterCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'Erc4626AdapterFactory',
                                event: 'Erc4626AdapterCreated',
                                block: {
                                    number: 13521369,
                                    timestamp: Math.floor(Date.parse('2024-04-23T00:28:05.000Z') / 1000),
                                },
                                logIndex: 0,
                                srcAddress: '0x917447f8f52e7db26ce7f52be2f3fcb4d4d00832',
                                params: { proxy: '0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5' },
                            },
                        ],
                    },
                },
            });

            expect(trace).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "addresses": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "contract": "Erc4626Adapter",
                        },
                      ],
                    },
                    "block": 13521369,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
