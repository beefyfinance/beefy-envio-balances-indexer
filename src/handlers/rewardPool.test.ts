import { createTestIndexer } from 'envio';
import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ZERO } from '../lib/decimal';

/** Ethereum mainnet reward pool from config.yaml */
const POOL_ETH = '0x5e3e4ed40e754254095f091aa51871d125f4380a' as const;

describe('RewardPool Handlers', () => {
    const blockNum = 17_539_954;
    const timestampSec = Math.floor(Date.parse('2024-06-15T12:00:00.000Z') / 1000);
    const trxHash = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const trxIdx = 2;

    const initSim = {
        contract: 'RewardPool' as const,
        event: 'Initialized' as const,
        block: { number: blockNum, timestamp: timestampSec },
        logIndex: 0,
        srcAddress: POOL_ETH,
        params: { version: 1n },
    };

    describe('Initialized event', () => {
        it('Should create RewardPool entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            {
                                contract: 'RewardPool',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: POOL_ETH,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create RewardPool entity with correct shareToken and underlyingToken'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "RewardPool": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "classic_id": undefined,
                          "clm_id": undefined,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17539954n,
                          "initializedTimestamp": "2024-06-15T12:00:00.000Z",
                          "shareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "underlyingToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "isVirtual": false,
                          "name": "Beefy QI Reward Pool",
                          "symbol": "rbeQI",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x6c9D885B37b131aa68794ee1549fFB80be381Fa9",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "isVirtual": false,
                          "name": "Beefy QI",
                          "symbol": "beQI",
                          "totalSupply": "0",
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

        it('Should handle already initialized RewardPool gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            initSim,
                            {
                                contract: 'RewardPool',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 1,
                                srcAddress: POOL_ETH,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when RewardPool is already initialized'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "RewardPool": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "classic_id": undefined,
                          "clm_id": undefined,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17539954n,
                          "initializedTimestamp": "2024-06-15T12:00:00.000Z",
                          "shareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "underlyingToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "isVirtual": false,
                          "name": "Beefy QI Reward Pool",
                          "symbol": "rbeQI",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x6c9D885B37b131aa68794ee1549fFB80be381Fa9",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "isVirtual": false,
                          "name": "Beefy QI",
                          "symbol": "beQI",
                          "totalSupply": "0",
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

        it('Should skip blacklisted RewardPool during initialization', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            {
                                contract: 'RewardPool',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: '0x0000000000000000000000000000000000000008',
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log blacklist status for blacklisted RewardPool'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 17539954,
                    "chainId": 1,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        // TODO: find an on-chain RewardPool where `stakedToken()` succeeds but the returned
        // address is not a valid ERC20 (decimals/name/symbol revert), exercising the
        // `getTokenMetadata -> status: 'invalid'` path in `getOrCreateToken`. Then drop the
        // `.skip`, fill in srcAddress + chainId, and let the inline snapshot regenerate.
        // biome-ignore lint/suspicious/noSkippedTests: intentional placeholder; see TODO above
        it.skip('Should skip RewardPool when underlying token metadata is invalid', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            {
                                contract: 'RewardPool',
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

    describe('Transfer event', () => {
        const userA = '0x94b32bdb9ff47f3239f04514bce862c7d95600ca';
        const userB = '0x515e02402b7a3f67551763206d12cbde2d98766f';

        it('Should update balances when Transfer event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            initSim,
                            {
                                contract: 'RewardPool',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 10,
                                srcAddress: POOL_ETH,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: userB,
                                    value: parseUnits('1', 18),
                                },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should update Account balances and create BalanceSnapshot when Transfer event is emitted'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Account": {
                      "sets": [
                        {
                          "address": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                        },
                        {
                          "address": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                        },
                      ],
                    },
                    "RewardPool": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "classic_id": undefined,
                          "clm_id": undefined,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17539954n,
                          "initializedTimestamp": "2024-06-15T12:00:00.000Z",
                          "shareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "underlyingToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 2,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "isVirtual": false,
                          "name": "Beefy QI Reward Pool",
                          "symbol": "rbeQI",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x6c9D885B37b131aa68794ee1549fFB80be381Fa9",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "isVirtual": false,
                          "name": "Beefy QI",
                          "symbol": "beQI",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "amount": "-1",
                          "chainId": 1,
                          "id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "1",
                          "chainId": 1,
                          "id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a-17539954-2-10",
                          "logIndex": 10,
                          "tokenBalance_id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a-17539954-2-10",
                          "logIndex": 10,
                          "tokenBalance_id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
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

        it('Should handle zero value transfers correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            initSim,
                            {
                                contract: 'RewardPool',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 11,
                                srcAddress: POOL_ETH,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: userB,
                                    value: 0n,
                                },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should handle zero value transfers without errors').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "RewardPool": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "classic_id": undefined,
                          "clm_id": undefined,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17539954n,
                          "initializedTimestamp": "2024-06-15T12:00:00.000Z",
                          "shareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "underlyingToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "isVirtual": false,
                          "name": "Beefy QI Reward Pool",
                          "symbol": "rbeQI",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x6c9D885B37b131aa68794ee1549fFB80be381Fa9",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "isVirtual": false,
                          "name": "Beefy QI",
                          "symbol": "beQI",
                          "totalSupply": "0",
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

        it('Should handle mint transfers (from zero address) correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            initSim,
                            {
                                contract: 'RewardPool',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 12,
                                srcAddress: POOL_ETH,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: ADDRESS_ZERO,
                                    to: userB,
                                    value: parseUnits('2', 18),
                                },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should correctly handle mint transfers from zero address').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Account": {
                      "sets": [
                        {
                          "address": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                        },
                      ],
                    },
                    "RewardPool": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "classic_id": undefined,
                          "clm_id": undefined,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17539954n,
                          "initializedTimestamp": "2024-06-15T12:00:00.000Z",
                          "shareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "underlyingToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "isVirtual": false,
                          "name": "Beefy QI Reward Pool",
                          "symbol": "rbeQI",
                          "totalSupply": "2",
                        },
                        {
                          "address": "0x6c9D885B37b131aa68794ee1549fFB80be381Fa9",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "isVirtual": false,
                          "name": "Beefy QI",
                          "symbol": "beQI",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "2",
                          "chainId": 1,
                          "id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "2",
                          "balanceBefore": "0",
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a-17539954-2-12",
                          "logIndex": 12,
                          "tokenBalance_id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
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

        it('Should handle burn transfers (to zero address) correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            initSim,
                            {
                                contract: 'RewardPool',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 13,
                                srcAddress: POOL_ETH,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: ADDRESS_ZERO,
                                    value: parseUnits('1', 18),
                                },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should correctly handle burn transfers to zero address').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Account": {
                      "sets": [
                        {
                          "address": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                        },
                      ],
                    },
                    "RewardPool": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "classic_id": undefined,
                          "clm_id": undefined,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17539954n,
                          "initializedTimestamp": "2024-06-15T12:00:00.000Z",
                          "shareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "underlyingToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "isVirtual": false,
                          "name": "Beefy QI Reward Pool",
                          "symbol": "rbeQI",
                          "totalSupply": "-1",
                        },
                        {
                          "address": "0x6c9D885B37b131aa68794ee1549fFB80be381Fa9",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "isVirtual": false,
                          "name": "Beefy QI",
                          "symbol": "beQI",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "amount": "-1",
                          "chainId": 1,
                          "id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a-17539954-2-13",
                          "logIndex": 13,
                          "tokenBalance_id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
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

        it('Should handle multiple transfers in the same block correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            initSim,
                            {
                                contract: 'RewardPool',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 14,
                                srcAddress: POOL_ETH,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: userB,
                                    value: parseUnits('1', 18),
                                },
                            },
                            {
                                contract: 'RewardPool',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 15,
                                srcAddress: POOL_ETH,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userB,
                                    to: userA,
                                    value: parseUnits('0.5', 18),
                                },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should process multiple Transfer events in the same block correctly').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Account": {
                      "sets": [
                        {
                          "address": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                        },
                        {
                          "address": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                        },
                      ],
                    },
                    "RewardPool": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "classic_id": undefined,
                          "clm_id": undefined,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17539954n,
                          "initializedTimestamp": "2024-06-15T12:00:00.000Z",
                          "shareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "underlyingToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 2,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "isVirtual": false,
                          "name": "Beefy QI Reward Pool",
                          "symbol": "rbeQI",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x6c9D885B37b131aa68794ee1549fFB80be381Fa9",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "isVirtual": false,
                          "name": "Beefy QI",
                          "symbol": "beQI",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "amount": "-0.5",
                          "chainId": 1,
                          "id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "0.5",
                          "chainId": 1,
                          "id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a-17539954-2-14",
                          "logIndex": 14,
                          "tokenBalance_id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a-17539954-2-14",
                          "logIndex": 14,
                          "tokenBalance_id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "0.5",
                          "balanceBefore": "1",
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a-17539954-2-15",
                          "logIndex": 15,
                          "tokenBalance_id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
                        },
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-0.5",
                          "balanceBefore": "-1",
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a-17539954-2-15",
                          "logIndex": 15,
                          "tokenBalance_id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "token_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
                        },
                      ],
                    },
                    "block": 17539954,
                    "chainId": 1,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });
    });

    describe('NotifyReward event', () => {
        const rewardToken = '0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1';

        it('Should create RewardPoolRewardedEvent when NotifyReward event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            initSim,
                            {
                                contract: 'RewardPool',
                                event: 'NotifyReward',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 20,
                                srcAddress: POOL_ETH,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    reward: rewardToken,
                                    amount: parseUnits('100', 18),
                                    duration: 86400n,
                                },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create RewardPoolRewardedEvent entity with correct reward token, amount, and vesting duration'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "RewardPool": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "classic_id": undefined,
                          "clm_id": undefined,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17539954n,
                          "initializedTimestamp": "2024-06-15T12:00:00.000Z",
                          "shareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "underlyingToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                        },
                      ],
                    },
                    "RewardPoolRewardedEvent": {
                      "sets": [
                        {
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc-2-20",
                          "logIndex": 20,
                          "poolShareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "rewardAmount": "100",
                          "rewardToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "rewardVestingSeconds": 86400n,
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "isVirtual": false,
                          "name": "Beefy QI Reward Pool",
                          "symbol": "rbeQI",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x6c9D885B37b131aa68794ee1549fFB80be381Fa9",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "isVirtual": false,
                          "name": "Beefy QI",
                          "symbol": "beQI",
                          "totalSupply": "0",
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

        it('Should handle zero reward amounts correctly', async () => {
            const indexer = createTestIndexer();

            expect(
                await indexer.process({
                    chains: {
                        1: {
                            simulate: [
                                initSim,
                                {
                                    contract: 'RewardPool',
                                    event: 'NotifyReward',
                                    block: { number: blockNum, timestamp: timestampSec },
                                    logIndex: 21,
                                    srcAddress: POOL_ETH,
                                    transaction: { hash: trxHash, transactionIndex: trxIdx },
                                    params: {
                                        reward: rewardToken,
                                        amount: 0n,
                                        duration: 0n,
                                    },
                                },
                            ],
                        },
                    },
                }),
                'Should handle zero reward amounts without errors'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "RewardPool": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "classic_id": undefined,
                          "clm_id": undefined,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17539954n,
                          "initializedTimestamp": "2024-06-15T12:00:00.000Z",
                          "shareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "underlyingToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                        },
                      ],
                    },
                    "RewardPoolRewardedEvent": {
                      "sets": [
                        {
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc-2-21",
                          "logIndex": 21,
                          "poolShareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "rewardAmount": "0",
                          "rewardToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "rewardVestingSeconds": 0n,
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "isVirtual": false,
                          "name": "Beefy QI Reward Pool",
                          "symbol": "rbeQI",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x6c9D885B37b131aa68794ee1549fFB80be381Fa9",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "isVirtual": false,
                          "name": "Beefy QI",
                          "symbol": "beQI",
                          "totalSupply": "0",
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

        it('Should handle multiple NotifyReward events in the same block correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            initSim,
                            {
                                contract: 'RewardPool',
                                event: 'NotifyReward',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 22,
                                srcAddress: POOL_ETH,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    reward: rewardToken,
                                    amount: parseUnits('1', 18),
                                    duration: 100n,
                                },
                            },
                            {
                                contract: 'RewardPool',
                                event: 'NotifyReward',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 23,
                                srcAddress: POOL_ETH,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    reward: rewardToken,
                                    amount: parseUnits('2', 18),
                                    duration: 200n,
                                },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should process multiple NotifyReward events in the same block correctly'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "RewardPool": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "classic_id": undefined,
                          "clm_id": undefined,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17539954n,
                          "initializedTimestamp": "2024-06-15T12:00:00.000Z",
                          "shareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "underlyingToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                        },
                      ],
                    },
                    "RewardPoolRewardedEvent": {
                      "sets": [
                        {
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc-2-22",
                          "logIndex": 22,
                          "poolShareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "rewardAmount": "1",
                          "rewardToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "rewardVestingSeconds": 100n,
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
                        },
                        {
                          "blockNumber": 17539954n,
                          "blockTimestamp": "2024-06-15T12:00:00.000Z",
                          "chainId": 1,
                          "id": "1-0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc-2-23",
                          "logIndex": 23,
                          "poolShareToken_id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "rewardAmount": "2",
                          "rewardToken_id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "rewardVestingSeconds": 200n,
                          "trxHash": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                          "trxIndex": 2,
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x5e3e4ed40e754254095f091aa51871d125f4380a",
                          "isVirtual": false,
                          "name": "Beefy QI Reward Pool",
                          "symbol": "rbeQI",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x6c9D885B37b131aa68794ee1549fFB80be381Fa9",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
                          "isVirtual": false,
                          "name": "Beefy QI",
                          "symbol": "beQI",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 17539954,
                    "chainId": 1,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });
    });
});
