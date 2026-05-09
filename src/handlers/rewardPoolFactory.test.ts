import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

describe('RewardPoolFactory Handlers', () => {
    describe('RewardPoolCreated event', () => {
        it('Should register RewardPool when RewardPoolCreated event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'RewardPoolFactory',
                                event: 'RewardPoolCreated',
                                block: { number: 16538679, timestamp: 1721000000 },
                                logIndex: 0,
                                srcAddress: '0x13f518aa15ca3296e51ceafb44a8d86660e97b3a',
                                params: { proxy: '0x00000000000000000000000000000000dead600d' },
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
                          "address": "0x00000000000000000000000000000000dead600d",
                          "contract": "RewardPool",
                        },
                      ],
                    },
                    "block": 16538679,
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
                                contract: 'RewardPoolFactory',
                                event: 'RewardPoolCreated',
                                block: { number: 13014756, timestamp: 1720000000 },
                                logIndex: 0,
                                srcAddress: '0x13f518aa15ca3296e51ceafb44a8d86660e97b3a',
                                params: { proxy: '0x0a1bbea11423f0cd2c247a9ad2ae6bd06aebc60d' },
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

    describe('RewardPoolCreatedWithName event', () => {
        it('Should register RewardPool when RewardPoolCreatedWithName event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'RewardPoolFactory',
                                event: 'RewardPoolCreatedWithName',
                                block: { number: 13014756, timestamp: 1720000000 },
                                logIndex: 1,
                                srcAddress: '0x13f518aa15ca3296e51ceafb44a8d86660e97b3a',
                                params: {
                                    rewardPoolName: 'test-pool',
                                    proxy: '0x00000000000000000000000000000000dead700e',
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
                          "address": "0x00000000000000000000000000000000dead700e",
                          "contract": "RewardPool",
                        },
                      ],
                    },
                    "block": 13014756,
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
                                contract: 'RewardPoolFactory',
                                event: 'RewardPoolCreatedWithName',
                                block: { number: 13014756, timestamp: 1720000000 },
                                logIndex: 2,
                                srcAddress: '0x13f518aa15ca3296e51ceafb44a8d86660e97b3a',
                                params: {
                                    rewardPoolName: 'blacklisted',
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
