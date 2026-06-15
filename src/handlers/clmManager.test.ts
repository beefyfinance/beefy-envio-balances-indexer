import { createTestIndexer } from 'envio';
import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ZERO } from '../lib/decimal';

/** Base CLM manager referenced from legacy token handler comments */
const MANAGER_BASE = '0x603492ff8943f5ac69aa69cf09fc96fda2606ee7' as const;

describe('ClmManager Handlers', () => {
    const blockNum = 17_452_334;
    const timestampSec = Math.floor(Date.parse('2024-06-10T12:00:00.000Z') / 1000);
    const trxHash = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const trxIdx = 5;

    const initSim = {
        contract: 'ClmManager' as const,
        event: 'Initialized' as const,
        block: { number: blockNum, timestamp: timestampSec },
        logIndex: 0,
        srcAddress: MANAGER_BASE,
        params: { version: 1n },
    };

    describe('Initialized event', () => {
        it('Should create ClmManager entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [initSim],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create ClmManager entity with correct shareToken, underlyingToken0, and underlyingToken1'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0",
                          "nativeToUSDPrice": "0",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "0",
                          "priceRangeMax1": "0",
                          "priceRangeMin1": "0",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "0",
                          "token1ToNativePrice": "0",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0",
                          "totalUnderlyingAmount1": "0",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0",
                          "underlyingMainAmount1": "0",
                          "underlyingProtocolPool": "0x0000000000000000000000000000000000000000",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
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
                    "block": 17452334,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should handle already initialized ClmManager gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClmManager',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 1,
                                srcAddress: MANAGER_BASE,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when ClmManager is already initialized'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0",
                          "nativeToUSDPrice": "0",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "0",
                          "priceRangeMax1": "0",
                          "priceRangeMin1": "0",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "0",
                          "token1ToNativePrice": "0",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0",
                          "totalUnderlyingAmount1": "0",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0",
                          "underlyingMainAmount1": "0",
                          "underlyingProtocolPool": "0x0000000000000000000000000000000000000000",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
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
                    "block": 17452334,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        it('Should skip blacklisted ClmManager during initialization', async () => {
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
                                srcAddress: '0x000000000000000000000000000000000000000b',
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log blacklist status for blacklisted ClmManager'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 17452334,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        // TODO: find an on-chain ClmManager where `wants()` succeeds but at least one of the
        // returned token0/token1 addresses is not a valid ERC20 (decimals/name/symbol revert),
        // so this exercises the `getTokenMetadata -> status: 'invalid'` path in
        // `getOrCreateToken`. Then drop the `.skip`, fill in srcAddress + chainId, and let
        // the inline snapshot regenerate.
        // biome-ignore lint/suspicious/noSkippedTests: intentional placeholder; see TODO above
        it.skip('Should skip ClmManager when underlying token metadata is invalid', async () => {
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
                    8453: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClmManager',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 10,
                                srcAddress: MANAGER_BASE,
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
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0",
                          "nativeToUSDPrice": "0",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "0",
                          "priceRangeMax1": "0",
                          "priceRangeMin1": "0",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "0",
                          "token1ToNativePrice": "0",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0",
                          "totalUnderlyingAmount1": "0",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0",
                          "underlyingMainAmount1": "0",
                          "underlyingProtocolPool": "0x0000000000000000000000000000000000000000",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 2,
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
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "amount": "-1",
                          "chainId": 8453,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "1",
                          "chainId": 8453,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 17452334n,
                          "blockTimestamp": "2024-06-10T12:00:00.000Z",
                          "chainId": 8453,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-10",
                          "logIndex": 10,
                          "tokenBalance_id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 17452334n,
                          "blockTimestamp": "2024-06-10T12:00:00.000Z",
                          "chainId": 8453,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-10",
                          "logIndex": 10,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                      ],
                    },
                    "block": 17452334,
                    "chainId": 8453,
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
                    8453: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClmManager',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 11,
                                srcAddress: MANAGER_BASE,
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
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0",
                          "nativeToUSDPrice": "0",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "0",
                          "priceRangeMax1": "0",
                          "priceRangeMin1": "0",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "0",
                          "token1ToNativePrice": "0",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0",
                          "totalUnderlyingAmount1": "0",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0",
                          "underlyingMainAmount1": "0",
                          "underlyingProtocolPool": "0x0000000000000000000000000000000000000000",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
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
                    "block": 17452334,
                    "chainId": 8453,
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
                    8453: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClmManager',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 12,
                                srcAddress: MANAGER_BASE,
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
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0",
                          "nativeToUSDPrice": "0",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "0",
                          "priceRangeMax1": "0",
                          "priceRangeMin1": "0",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "0",
                          "token1ToNativePrice": "0",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0",
                          "totalUnderlyingAmount1": "0",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0",
                          "underlyingMainAmount1": "0",
                          "underlyingProtocolPool": "0x0000000000000000000000000000000000000000",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDC",
                          "symbol": "cowSushiBaseWETH-USDC",
                          "totalSupply": "2",
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
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "2",
                          "chainId": 8453,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "2",
                          "balanceBefore": "0",
                          "blockNumber": 17452334n,
                          "blockTimestamp": "2024-06-10T12:00:00.000Z",
                          "chainId": 8453,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-12",
                          "logIndex": 12,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                      ],
                    },
                    "block": 17452334,
                    "chainId": 8453,
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
                    8453: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClmManager',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 13,
                                srcAddress: MANAGER_BASE,
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
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0",
                          "nativeToUSDPrice": "0",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "0",
                          "priceRangeMax1": "0",
                          "priceRangeMin1": "0",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "0",
                          "token1ToNativePrice": "0",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0",
                          "totalUnderlyingAmount1": "0",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0",
                          "underlyingMainAmount1": "0",
                          "underlyingProtocolPool": "0x0000000000000000000000000000000000000000",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDC",
                          "symbol": "cowSushiBaseWETH-USDC",
                          "totalSupply": "-1",
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
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "amount": "-1",
                          "chainId": 8453,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 17452334n,
                          "blockTimestamp": "2024-06-10T12:00:00.000Z",
                          "chainId": 8453,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-13",
                          "logIndex": 13,
                          "tokenBalance_id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                      ],
                    },
                    "block": 17452334,
                    "chainId": 8453,
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
                    8453: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClmManager',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 14,
                                srcAddress: MANAGER_BASE,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: userB,
                                    value: parseUnits('1', 18),
                                },
                            },
                            {
                                contract: 'ClmManager',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 15,
                                srcAddress: MANAGER_BASE,
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
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0",
                          "nativeToUSDPrice": "0",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "0",
                          "priceRangeMax1": "0",
                          "priceRangeMin1": "0",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "0",
                          "token1ToNativePrice": "0",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0",
                          "totalUnderlyingAmount1": "0",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0",
                          "underlyingMainAmount1": "0",
                          "underlyingProtocolPool": "0x0000000000000000000000000000000000000000",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-06-10T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 2,
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
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "amount": "-0.5",
                          "chainId": 8453,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "0.5",
                          "chainId": 8453,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 17452334n,
                          "blockTimestamp": "2024-06-10T12:00:00.000Z",
                          "chainId": 8453,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-14",
                          "logIndex": 14,
                          "tokenBalance_id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 17452334n,
                          "blockTimestamp": "2024-06-10T12:00:00.000Z",
                          "chainId": 8453,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-14",
                          "logIndex": 14,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "0.5",
                          "balanceBefore": "1",
                          "blockNumber": 17452334n,
                          "blockTimestamp": "2024-06-10T12:00:00.000Z",
                          "chainId": 8453,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-15",
                          "logIndex": 15,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-0.5",
                          "balanceBefore": "-1",
                          "blockNumber": 17452334n,
                          "blockTimestamp": "2024-06-10T12:00:00.000Z",
                          "chainId": 8453,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-15",
                          "logIndex": 15,
                          "tokenBalance_id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                      ],
                    },
                    "block": 17452334,
                    "chainId": 8453,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });
    });
});
