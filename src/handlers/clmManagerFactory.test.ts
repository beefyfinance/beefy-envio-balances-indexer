import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

describe('ClmManagerFactory Handlers', () => {
    describe('ClmManagerCreated event', () => {
        it('Should register ClmManager when ClmManagerCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmManagerFactory',
                                event: 'ClmManagerCreated',
                                block: { number: 17452329, timestamp: 1719000000 },
                                logIndex: 0,
                                srcAddress: '0x7bc78990ac1ef0754cfde935b2d84e9acf13ed29',
                                params: { proxy: '0x603492ff8943f5ac69aa69cf09fc96fda2606ee7' },
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
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
                        },
                      ],
                    },
                    "block": 17452329,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
