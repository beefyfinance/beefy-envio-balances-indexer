import { createTestIndexer } from 'envio';
import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import { FACTORIES, registerClassicBoost } from './testFixtures/register';

describe('ClassicBoost Handlers', () => {
    const boostAddr = '0x01e8881ed2fb41e0b3df29f382faf707a0b26969' as const;
    const trxHash = '0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2';
    const trxIndex = 7;
    const blockNum = 2578061;
    const timestampSec = Math.floor(Date.parse('2023-08-13T16:51:09.000Z') / 1000);
    const userAddr = '0xc29d2531651fcd304c60fbfb8073a518d8fe0a21';

    describe('Initialized event', () => {
        it('Should create ClassicBoost entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            // Tx: https://basescan.org/tx/0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 4,
                                srcAddress: boostAddr,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create ClassicBoost entity with correct shareToken and underlyingToken'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClassicBoost": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "classic_id": undefined,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 2578061n,
                          "initializedTimestamp": 2023-08-13T16:51:09.000Z,
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "shareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "underlyingToken_id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "isVirtual": true,
                          "name": "Moo BaseSwap cbETH-WETH Boost",
                          "symbol": "mooBaseSwapcbETH-WETH Boost",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xA6854c1F54198D351D6d4263806F5A876099839b",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                          "isVirtual": false,
                          "name": "Moo BaseSwap cbETH-WETH",
                          "symbol": "mooBaseSwapcbETH-WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "isVirtual": false,
                          "name": "AlienBase Token",
                          "symbol": "ALB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 2578061,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should handle already initialized ClassicBoost gracefully', async () => {
            const indexer = createTestIndexer();
            const dupBlock = 2855526;
            const dupTs = Math.floor(Date.parse('2024-06-01T12:00:00.000Z') / 1000);

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: dupBlock, timestamp: dupTs },
                                logIndex: 10,
                                srcAddress: boostAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: dupBlock, timestamp: dupTs },
                                logIndex: 11,
                                srcAddress: boostAddr,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when ClassicBoost is already initialized'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClassicBoost": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "classic_id": undefined,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 2855526n,
                          "initializedTimestamp": 2024-06-01T12:00:00.000Z,
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "shareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "underlyingToken_id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "isVirtual": true,
                          "name": "Moo BaseSwap cbETH-WETH Boost",
                          "symbol": "mooBaseSwapcbETH-WETH Boost",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xA6854c1F54198D351D6d4263806F5A876099839b",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                          "isVirtual": false,
                          "name": "Moo BaseSwap cbETH-WETH",
                          "symbol": "mooBaseSwapcbETH-WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "isVirtual": false,
                          "name": "AlienBase Token",
                          "symbol": "ALB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 2855526,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        it('Should skip blacklisted ClassicBoost during initialization', async () => {
            const indexer = createTestIndexer();
            const badBoost = '0x0000000000000000000000000000000000000001';
            const blk = 17539954;
            const ts = Math.floor(Date.parse('2024-06-15T00:00:00.000Z') / 1000);

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            registerClassicBoost({
                                factory: FACTORIES[1].ClassicBoostFactory,
                                proxy: badBoost,
                                block: { number: blk, timestamp: ts },
                                logIndex: 0,
                            }),
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: blk, timestamp: ts },
                                logIndex: 1,
                                srcAddress: badBoost,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(
                trace,
                'Should return null and log blacklist status for blacklisted ClassicBoost'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x0000000000000000000000000000000000000001",
                          "contract": "ClassicBoost",
                        },
                      ],
                    },
                    "block": 17539954,
                    "chainId": 1,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        // TODO: find an on-chain ClassicBoost where `stakedToken()` succeeds but the returned
        // address is not a valid ERC20 (decimals/name/symbol revert), exercising the
        // `getTokenMetadata -> status: 'invalid'` path in `getOrCreateToken`. Then drop the
        // `.skip`, fill in srcAddress + chainId, and let the inline snapshot regenerate.
        // biome-ignore lint/suspicious/noSkippedTests: intentional placeholder; see TODO above
        it.skip('Should skip ClassicBoost when underlying token metadata is invalid', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: '0x0000000000000000000000000000000000000000',
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log blacklist status when underlying token metadata is invalid'
            ).toMatchInlineSnapshot();
        });
    });

    describe('Staked event', () => {
        const stakeAmount = parseUnits('1', 18);

        it('Should update balances when Staked event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 4,
                                srcAddress: boostAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicBoost',
                                event: 'Staked',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 20,
                                srcAddress: boostAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIndex },
                                params: { user: userAddr, amount: stakeAmount },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should update Account balances and create BalanceSnapshot when Staked event is emitted'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Account": {
                      "sets": [
                        {
                          "address": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                        },
                      ],
                    },
                    "ClassicBoost": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "classic_id": undefined,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 2578061n,
                          "initializedTimestamp": 2023-08-13T16:51:09.000Z,
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "shareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "underlyingToken_id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "isVirtual": true,
                          "name": "Moo BaseSwap cbETH-WETH Boost",
                          "symbol": "mooBaseSwapcbETH-WETH Boost",
                          "totalSupply": "1",
                        },
                        {
                          "address": "0xA6854c1F54198D351D6d4263806F5A876099839b",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                          "isVirtual": false,
                          "name": "Moo BaseSwap cbETH-WETH",
                          "symbol": "mooBaseSwapcbETH-WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "isVirtual": false,
                          "name": "AlienBase Token",
                          "symbol": "ALB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "amount": "1",
                          "id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "token_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 2578061n,
                          "blockTimestamp": 2023-08-13T16:51:09.000Z,
                          "id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969-2578061-7-20",
                          "logIndex": 20,
                          "tokenBalance_id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "token_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "trxHash": "0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2",
                          "trxIndex": 7,
                        },
                      ],
                    },
                    "block": 2578061,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        it('Should handle zero amount stakes correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 4,
                                srcAddress: boostAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicBoost',
                                event: 'Staked',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 21,
                                srcAddress: boostAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIndex },
                                params: { user: userAddr, amount: 0n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should handle zero amount stakes without errors').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClassicBoost": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "classic_id": undefined,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 2578061n,
                          "initializedTimestamp": 2023-08-13T16:51:09.000Z,
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "shareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "underlyingToken_id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "isVirtual": true,
                          "name": "Moo BaseSwap cbETH-WETH Boost",
                          "symbol": "mooBaseSwapcbETH-WETH Boost",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xA6854c1F54198D351D6d4263806F5A876099839b",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                          "isVirtual": false,
                          "name": "Moo BaseSwap cbETH-WETH",
                          "symbol": "mooBaseSwapcbETH-WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "isVirtual": false,
                          "name": "AlienBase Token",
                          "symbol": "ALB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 2578061,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        it('Should handle multiple stakes in the same block correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 4,
                                srcAddress: boostAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicBoost',
                                event: 'Staked',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 22,
                                srcAddress: boostAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIndex },
                                params: { user: userAddr, amount: stakeAmount },
                            },
                            {
                                contract: 'ClassicBoost',
                                event: 'Staked',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 23,
                                srcAddress: boostAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIndex },
                                params: { user: userAddr, amount: stakeAmount },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should process multiple Staked events in the same block correctly').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Account": {
                      "sets": [
                        {
                          "address": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                        },
                      ],
                    },
                    "ClassicBoost": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "classic_id": undefined,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 2578061n,
                          "initializedTimestamp": 2023-08-13T16:51:09.000Z,
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "shareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "underlyingToken_id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "isVirtual": true,
                          "name": "Moo BaseSwap cbETH-WETH Boost",
                          "symbol": "mooBaseSwapcbETH-WETH Boost",
                          "totalSupply": "2",
                        },
                        {
                          "address": "0xA6854c1F54198D351D6d4263806F5A876099839b",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                          "isVirtual": false,
                          "name": "Moo BaseSwap cbETH-WETH",
                          "symbol": "mooBaseSwapcbETH-WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "isVirtual": false,
                          "name": "AlienBase Token",
                          "symbol": "ALB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "amount": "2",
                          "id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "token_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 2578061n,
                          "blockTimestamp": 2023-08-13T16:51:09.000Z,
                          "id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969-2578061-7-22",
                          "logIndex": 22,
                          "tokenBalance_id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "token_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "trxHash": "0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2",
                          "trxIndex": 7,
                        },
                        {
                          "account_id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "balanceAfter": "2",
                          "balanceBefore": "1",
                          "blockNumber": 2578061n,
                          "blockTimestamp": 2023-08-13T16:51:09.000Z,
                          "id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969-2578061-7-23",
                          "logIndex": 23,
                          "tokenBalance_id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "token_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "trxHash": "0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2",
                          "trxIndex": 7,
                        },
                      ],
                    },
                    "block": 2578061,
                    "chainId": 8453,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });
    });

    describe('Withdrawn event', () => {
        const withdrawAmt = parseUnits('1', 18);

        it('Should update balances when Withdrawn event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 4,
                                srcAddress: boostAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicBoost',
                                event: 'Staked',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 30,
                                srcAddress: boostAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIndex },
                                params: { user: userAddr, amount: withdrawAmt },
                            },
                            {
                                contract: 'ClassicBoost',
                                event: 'Withdrawn',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 31,
                                srcAddress: boostAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIndex },
                                params: { user: userAddr, amount: withdrawAmt },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should update Account balances and create BalanceSnapshot when Withdrawn event is emitted'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Account": {
                      "sets": [
                        {
                          "address": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                        },
                      ],
                    },
                    "ClassicBoost": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "classic_id": undefined,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 2578061n,
                          "initializedTimestamp": 2023-08-13T16:51:09.000Z,
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "shareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "underlyingToken_id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "isVirtual": true,
                          "name": "Moo BaseSwap cbETH-WETH Boost",
                          "symbol": "mooBaseSwapcbETH-WETH Boost",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xA6854c1F54198D351D6d4263806F5A876099839b",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                          "isVirtual": false,
                          "name": "Moo BaseSwap cbETH-WETH",
                          "symbol": "mooBaseSwapcbETH-WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "isVirtual": false,
                          "name": "AlienBase Token",
                          "symbol": "ALB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "amount": "0",
                          "id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "token_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 2578061n,
                          "blockTimestamp": 2023-08-13T16:51:09.000Z,
                          "id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969-2578061-7-30",
                          "logIndex": 30,
                          "tokenBalance_id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "token_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "trxHash": "0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2",
                          "trxIndex": 7,
                        },
                        {
                          "account_id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "balanceAfter": "0",
                          "balanceBefore": "1",
                          "blockNumber": 2578061n,
                          "blockTimestamp": 2023-08-13T16:51:09.000Z,
                          "id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969-2578061-7-31",
                          "logIndex": 31,
                          "tokenBalance_id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "token_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "trxHash": "0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2",
                          "trxIndex": 7,
                        },
                      ],
                    },
                    "block": 2578061,
                    "chainId": 8453,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });

        it('Should handle zero amount withdrawals correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 4,
                                srcAddress: boostAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicBoost',
                                event: 'Withdrawn',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 32,
                                srcAddress: boostAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIndex },
                                params: { user: userAddr, amount: 0n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should handle zero amount withdrawals without errors').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClassicBoost": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "classic_id": undefined,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 2578061n,
                          "initializedTimestamp": 2023-08-13T16:51:09.000Z,
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "shareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "underlyingToken_id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "isVirtual": true,
                          "name": "Moo BaseSwap cbETH-WETH Boost",
                          "symbol": "mooBaseSwapcbETH-WETH Boost",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xA6854c1F54198D351D6d4263806F5A876099839b",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                          "isVirtual": false,
                          "name": "Moo BaseSwap cbETH-WETH",
                          "symbol": "mooBaseSwapcbETH-WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "isVirtual": false,
                          "name": "AlienBase Token",
                          "symbol": "ALB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 2578061,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });
    });

    describe('RewardAdded event', () => {
        const rewardAmt = parseUnits('0.5', 18);

        it('Should create RewardPoolRewardedEvent when RewardAdded event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 4,
                                srcAddress: boostAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicBoost',
                                event: 'RewardAdded',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 40,
                                srcAddress: boostAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIndex },
                                params: { reward: rewardAmt },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create RewardPoolRewardedEvent entity with correct reward token and amount'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClassicBoost": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "classic_id": undefined,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 2578061n,
                          "initializedTimestamp": 2023-08-13T16:51:09.000Z,
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "shareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "underlyingToken_id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                        },
                      ],
                    },
                    "RewardPoolRewardedEvent": {
                      "sets": [
                        {
                          "blockNumber": 2578061n,
                          "blockTimestamp": 2023-08-13T16:51:09.000Z,
                          "id": "8453-0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2-7-40",
                          "logIndex": 40,
                          "poolShareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "rewardAmount": "0.5",
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "rewardVestingSeconds": 0n,
                          "trxHash": "0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2",
                          "trxIndex": 7,
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "isVirtual": true,
                          "name": "Moo BaseSwap cbETH-WETH Boost",
                          "symbol": "mooBaseSwapcbETH-WETH Boost",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xA6854c1F54198D351D6d4263806F5A876099839b",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                          "isVirtual": false,
                          "name": "Moo BaseSwap cbETH-WETH",
                          "symbol": "mooBaseSwapcbETH-WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "isVirtual": false,
                          "name": "AlienBase Token",
                          "symbol": "ALB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 2578061,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        it('Should handle zero reward amounts correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicBoost',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 4,
                                srcAddress: boostAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicBoost',
                                event: 'RewardAdded',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 41,
                                srcAddress: boostAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIndex },
                                params: { reward: 0n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should handle zero reward amounts without errors').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClassicBoost": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "classic_id": undefined,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 2578061n,
                          "initializedTimestamp": 2023-08-13T16:51:09.000Z,
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "shareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "underlyingToken_id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                        },
                      ],
                    },
                    "RewardPoolRewardedEvent": {
                      "sets": [
                        {
                          "blockNumber": 2578061n,
                          "blockTimestamp": 2023-08-13T16:51:09.000Z,
                          "id": "8453-0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2-7-41",
                          "logIndex": 41,
                          "poolShareToken_id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "rewardAmount": "0",
                          "rewardToken_id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "rewardVestingSeconds": 0n,
                          "trxHash": "0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2",
                          "trxIndex": 7,
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
                          "isVirtual": true,
                          "name": "Moo BaseSwap cbETH-WETH Boost",
                          "symbol": "mooBaseSwapcbETH-WETH Boost",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xA6854c1F54198D351D6d4263806F5A876099839b",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0xa6854c1f54198d351d6d4263806f5a876099839b",
                          "isVirtual": false,
                          "name": "Moo BaseSwap cbETH-WETH",
                          "symbol": "mooBaseSwapcbETH-WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
                          "isVirtual": false,
                          "name": "AlienBase Token",
                          "symbol": "ALB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 2578061,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });
    });
});
