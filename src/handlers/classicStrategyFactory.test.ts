import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

describe('ClassicStrategyFactory Handlers', () => {
    describe('StrategyCreated event', () => {
        it('Should register ClassicStrategy when StrategyCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicStrategyFactory',
                                event: 'StrategyCreated',
                                block: { number: 10003201, timestamp: 1717000000 },
                                logIndex: 0,
                                srcAddress: '0x705a3168f2c48263b1249a11940e6602a4f22a9a',
                                params: { proxy: '0x00000000000000000000000000000000feed1010' },
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
                          "address": "0x00000000000000000000000000000000feed1010",
                          "contract": "ClassicStrategy",
                        },
                      ],
                    },
                    "block": 10003201,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
