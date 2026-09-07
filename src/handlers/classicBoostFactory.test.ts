import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

describe('ClassicBoostFactory Handlers', () => {
    const boostAddr = '0x01e8881ed2fb41e0b3df29f382faf707a0b26969' as const;
    const blockNum = 17_539_954;
    const timestampSec = Math.floor(Date.parse('2023-08-13T16:51:09.000Z') / 1000);

    describe('BoostCreated event', () => {
        it('Should register ClassicBoost when BoostCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            // Tx: https://basescan.org/tx/0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2
                            {
                                contract: 'ClassicBoostFactory',
                                event: 'BoostCreated',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 3,
                                srcAddress: '0x6f168346aed66f37cd972191ec4c3db11b8e5ecd',
                                params: { proxy: boostAddr },
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
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "contract": "ClassicBoost",
                        },
                      ],
                    },
                    "block": 17539954,
                    "chainId": 1,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });

    describe('BoostDeployed event', () => {
        it('Should register ClassicBoost when BoostDeployed event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            // Tx: https://basescan.org/tx/0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2
                            {
                                contract: 'ClassicBoostFactory',
                                event: 'BoostDeployed',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 3,
                                srcAddress: '0x6f168346aed66f37cd972191ec4c3db11b8e5ecd',
                                params: { boost: boostAddr },
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
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "contract": "ClassicBoost",
                        },
                      ],
                    },
                    "block": 17539954,
                    "chainId": 1,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
