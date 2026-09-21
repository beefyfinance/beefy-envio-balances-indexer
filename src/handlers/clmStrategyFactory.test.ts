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

    describe('ClmStrategyCreatedWithName event', () => {
        it('Should register ClmStrategy when the named ProxyCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmStrategyFactory',
                                event: 'ClmStrategyCreatedWithName',
                                block: { number: 14758086, timestamp: 1777555097 },
                                logIndex: 1,
                                srcAddress: '0x9476284d81121613da5df5c72f50853a455448f1',
                                params: {
                                    strategyName: 'StrategyPassiveManagerUniswap_V1',
                                    proxy: '0xf1f7c6a59b07ff5365751e1a8d482afb1065b5a4',
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
                    "addresses": {
                      "sets": [
                        {
                          "address": "0xf1f7c6a59b07ff5365751e1a8d482afb1065b5a4",
                          "contract": "ClmStrategy",
                        },
                      ],
                    },
                    "block": 14758086,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
