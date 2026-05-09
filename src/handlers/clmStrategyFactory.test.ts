import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

describe('ClmStrategyFactory Handlers', () => {
    describe('ClmStrategyCreated event', () => {
        it('Should register ClmStrategy when ClmStrategyCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmStrategyFactory',
                                event: 'ClmStrategyCreated',
                                block: { number: 15683455, timestamp: 1722000000 },
                                logIndex: 0,
                                srcAddress: '0x9476284d81121613da5df5c72f50853a455448f1',
                                params: { proxy: '0x00000000000000000000000000000000abcdecaf' },
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
                          "address": "0x00000000000000000000000000000000abcdecaf",
                          "contract": "ClmStrategy",
                        },
                      ],
                    },
                    "block": 15683455,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
