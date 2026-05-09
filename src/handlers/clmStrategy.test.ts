import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

/**
 * Base sushi cow WETH-USDC pair from {@link https://api.beefy.finance/cow-vaults}:
 * earnContractAddress → manager, strategy.vault() → manager.
 */
const MANAGER_BASE = '0x603492ff8943f5ac69aa69cf09fc96fda2606ee7' as const;
const STRATEGY_BASE = '0x51582dcef28aea484dd87933324a55482882ce17' as const;

describe('ClmStrategy Handlers', () => {
    const blockNum = 15_683_455;
    const timestampSec = Math.floor(Date.parse('2024-07-15T12:00:00.000Z') / 1000);

    describe('Initialized event', () => {
        it('Should create ClmStrategy entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmManager',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: MANAGER_BASE,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClmStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 1,
                                srcAddress: STRATEGY_BASE,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });

            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should create ClmStrategy entity linked to existing ClmManager').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 15683455n,
                          "initializedTimestamp": "2024-07-15T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmStrategy": {
                      "sets": [
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 15683455n,
                          "initializedTimestamp": "2024-07-15T12:00:00.000Z",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDC",
                          "symbol": "cowSushiBaseWETH-USDC",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x4200000000000000000000000000000000000006",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x4200000000000000000000000000000000000006",
                          "isVirtual": false,
                          "name": "Wrapped Ether",
                          "symbol": "WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                          "chainId": 8453,
                          "decimals": 6,
                          "holderCount": 0,
                          "id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                          "isVirtual": false,
                          "name": "USD Coin",
                          "symbol": "USDC",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 15683455,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        it('Should handle already initialized ClmStrategy gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmManager',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: MANAGER_BASE,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClmStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 1,
                                srcAddress: STRATEGY_BASE,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClmStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 2,
                                srcAddress: STRATEGY_BASE,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });

            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when ClmStrategy is already initialized'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 15683455n,
                          "initializedTimestamp": "2024-07-15T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmStrategy": {
                      "sets": [
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 15683455n,
                          "initializedTimestamp": "2024-07-15T12:00:00.000Z",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDC",
                          "symbol": "cowSushiBaseWETH-USDC",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x4200000000000000000000000000000000000006",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x4200000000000000000000000000000000000006",
                          "isVirtual": false,
                          "name": "Wrapped Ether",
                          "symbol": "WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                          "chainId": 8453,
                          "decimals": 6,
                          "holderCount": 0,
                          "id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                          "isVirtual": false,
                          "name": "USD Coin",
                          "symbol": "USDC",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 15683455,
                    "chainId": 8453,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });

        it('Should skip ClmStrategy with zero address manager', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: '0x0000000000000000000000000000000000000001',
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should return null and log error when manager address is zero').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 15683455,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should skip ClmStrategy when parent ClmManager does not exist', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: STRATEGY_BASE,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log warning when ClmManager parent entity does not exist'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
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
