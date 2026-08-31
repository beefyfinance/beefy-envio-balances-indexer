import { createTestIndexer } from 'envio';
import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ZERO } from '../lib/decimal';
import { BASE_DEPOSIT, BASE_WITHDRAW, eventMeta, initBaseClmSim } from './testFixtures/clm';
import { FACTORIES, registerClmManager } from './testFixtures/register';

/** Base CLM manager referenced from legacy token handler comments */
const MANAGER_BASE = '0x603492ff8943f5ac69aa69cf09fc96fda2606ee7' as const;

describe('ClmManager Handlers', () => {
    const blockNum = 17_452_334;
    const timestampSec = Math.floor(Date.parse('2024-06-10T12:00:00.000Z') / 1000);
    const trxHash = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const trxIdx = 5;

    const registerSim = registerClmManager({
        factory: FACTORIES[8453].ClmManagerFactory,
        proxy: MANAGER_BASE,
        block: { number: blockNum, timestamp: timestampSec },
        logIndex: 0,
    });
    const initSim = {
        contract: 'ClmManager' as const,
        event: 'Initialized' as const,
        block: { number: blockNum, timestamp: timestampSec },
        logIndex: 1,
        srcAddress: MANAGER_BASE,
        params: { version: 1n },
    };
    const initSims = [registerSim, initSim];

    describe('Initialized event', () => {
        it('Should create ClmManager entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: initSims,
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
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
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

        it('Should handle already initialized ClmManager gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initSims,
                            {
                                contract: 'ClmManager',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 2,
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
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
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

        it('Should skip blacklisted ClmManager during initialization', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            registerClmManager({
                                factory: FACTORIES[8453].ClmManagerFactory,
                                proxy: '0x000000000000000000000000000000000000000b',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                            }),
                            {
                                contract: 'ClmManager',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 1,
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
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x000000000000000000000000000000000000000b",
                          "contract": "ClmManager",
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
                            ...initSims,
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
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "1",
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
                          "blockTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "blockTimestamp": 2024-06-10T12:00:00.000Z,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-10",
                          "logIndex": 10,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                      ],
                    },
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
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

        it('Should handle zero value transfers correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initSims,
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
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
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

        it('Should handle mint transfers (from zero address) correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initSims,
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
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "blockTimestamp": 2024-06-10T12:00:00.000Z,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-12",
                          "logIndex": 12,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                      ],
                    },
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
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

        it('Should handle burn transfers (to zero address) correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initSims,
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
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "blockTimestamp": 2024-06-10T12:00:00.000Z,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-13",
                          "logIndex": 13,
                          "tokenBalance_id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                      ],
                    },
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
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

        it('Should handle multiple transfers in the same block correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initSims,
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
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "0.5",
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
                          "blockTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "blockTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "blockTimestamp": 2024-06-10T12:00:00.000Z,
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
                          "blockTimestamp": 2024-06-10T12:00:00.000Z,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452334-5-15",
                          "logIndex": 15,
                          "tokenBalance_id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                      ],
                    },
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
                        },
                      ],
                    },
                    "block": 17452334,
                    "chainId": 8453,
                    "eventsProcessed": 4,
                  },
                ],
              }
            `);
        });
    });

    describe('Deposit event', () => {
        /** Fixture user is blacklisted on Base; use a non-blacklisted address for handler tests. */
        const depositUser = '0x94b32bdb9ff47f3239f04514bce862c7d95600ca';

        it('Should create ClmDepositEvent when Deposit event is emitted', async () => {
            const indexer = createTestIndexer();
            const block = { number: BASE_DEPOSIT.blockNum, timestamp: BASE_DEPOSIT.timestampSec };

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initBaseClmSim({
                                blockNum: block.number,
                                timestampSec: block.timestamp,
                            }),
                            {
                                contract: 'ClmManager',
                                event: 'Deposit',
                                srcAddress: MANAGER_BASE,
                                params: {
                                    user: depositUser,
                                    shares: BASE_DEPOSIT.shares,
                                    amount0: BASE_DEPOSIT.amount0,
                                    amount1: BASE_DEPOSIT.amount1,
                                    fee0: BASE_DEPOSIT.fee0,
                                    fee1: BASE_DEPOSIT.fee1,
                                },
                                ...eventMeta({
                                    block,
                                    trxHash: BASE_DEPOSIT.trxHash,
                                    trxIndex: BASE_DEPOSIT.trxIndex,
                                    logIndex: BASE_DEPOSIT.logIndex,
                                }),
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should create ClmDepositEvent with deposit amounts and fees').toMatchInlineSnapshot(`
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
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": 2024-07-23T00:24:27.000Z,
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0.000000000010342879",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                          "underlyingProtocolPool": "0x57713f7716e0b0f65ec116912f834e49805480d2",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmDepositEvent": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "amount0": "0.0015",
                          "amount1": "5.171663",
                          "blockNumber": 17452460n,
                          "blockTimestamp": 2024-07-23T00:24:27.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "fee0": "0",
                          "fee1": "0",
                          "id": "8453-0x5a4fbda772ea9a1754da8fff90de60da9fb2acb06432ea0c9a7cd8719c05443d-6-22",
                          "logIndex": 22,
                          "shares": "0.000000000010341879",
                          "trxHash": "0x5a4fbda772ea9a1754da8fff90de60da9fb2acb06432ea0c9a7cd8719c05443d",
                          "trxIndex": 6,
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": 2024-07-23T00:24:27.000Z,
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": 2024-07-23T00:24:27.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-3600-1721692800",
                          "managerTotalSupply": "0.000000000010342879",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "period": 3600n,
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2024-07-23T00:00:00.000Z,
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                        },
                        {
                          "blockTimestamp": 2024-07-23T00:24:27.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-86400-1721692800",
                          "managerTotalSupply": "0.000000000010342879",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "period": 86400n,
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2024-07-23T00:00:00.000Z,
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                        },
                        {
                          "blockTimestamp": 2024-07-23T00:24:27.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-604800-1721520000",
                          "managerTotalSupply": "0.000000000010342879",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "period": 604800n,
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2024-07-21T00:00:00.000Z,
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                        },
                      ],
                    },
                    "ClmStrategy": {
                      "sets": [
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": 2024-07-23T00:24:27.000Z,
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
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
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
                        },
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "contract": "ClmStrategy",
                        },
                      ],
                    },
                    "block": 17452460,
                    "chainId": 8453,
                    "eventsProcessed": 5,
                  },
                ],
              }
            `);
        });
    });

    describe('Withdraw event', () => {
        /** Fixture user is blacklisted on Base; use a non-blacklisted address for handler tests. */
        const withdrawUser = '0x94b32bdb9ff47f3239f04514bce862c7d95600ca';

        it('Should create ClmWithdrawEvent when Withdraw event is emitted', async () => {
            const indexer = createTestIndexer();
            const block = { number: BASE_WITHDRAW.blockNum, timestamp: BASE_WITHDRAW.timestampSec };

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initBaseClmSim({
                                blockNum: block.number,
                                timestampSec: block.timestamp,
                            }),
                            {
                                contract: 'ClmManager',
                                event: 'Withdraw',
                                srcAddress: MANAGER_BASE,
                                params: {
                                    user: withdrawUser,
                                    shares: BASE_WITHDRAW.shares,
                                    amount0: BASE_WITHDRAW.amount0,
                                    amount1: BASE_WITHDRAW.amount1,
                                },
                                ...eventMeta({
                                    block,
                                    trxHash: BASE_WITHDRAW.trxHash,
                                    trxIndex: BASE_WITHDRAW.trxIndex,
                                    logIndex: BASE_WITHDRAW.logIndex,
                                }),
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should create ClmWithdrawEvent with withdraw amounts').toMatchInlineSnapshot(`
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
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17495891n,
                          "initializedTimestamp": 2024-07-24T00:32:09.000Z,
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0.000000009498571634",
                          "nativeToUSDPrice": "3477.19247789",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "3477.579505",
                          "priceRangeMax1": "3729.358266",
                          "priceRangeMin1": "3242.171015",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287576366956",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "1.346749348905999398",
                          "totalUnderlyingAmount1": "4850.999579",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "154.827449",
                          "underlyingMainAmount0": "1.347136843885842153",
                          "underlyingMainAmount1": "4697.529447",
                          "underlyingProtocolPool": "0x57713f7716e0b0f65ec116912f834e49805480d2",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17495891n,
                          "initializedTimestamp": 2024-07-24T00:32:09.000Z,
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": 2024-07-24T00:32:09.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-3600-1721779200",
                          "managerTotalSupply": "0.000000009498571634",
                          "nativeToUSDPrice": "3477.19247789",
                          "outputToNativePrices": [],
                          "period": 3600n,
                          "priceOfToken0InToken1": "3477.579505",
                          "priceRangeMax1": "3729.358266",
                          "priceRangeMin1": "3242.171015",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2024-07-24T00:00:00.000Z,
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287576366956",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "1.346749348905999398",
                          "totalUnderlyingAmount1": "4850.999579",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "154.827449",
                          "underlyingMainAmount0": "1.347136843885842153",
                          "underlyingMainAmount1": "4697.529447",
                        },
                        {
                          "blockTimestamp": 2024-07-24T00:32:09.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-86400-1721779200",
                          "managerTotalSupply": "0.000000009498571634",
                          "nativeToUSDPrice": "3477.19247789",
                          "outputToNativePrices": [],
                          "period": 86400n,
                          "priceOfToken0InToken1": "3477.579505",
                          "priceRangeMax1": "3729.358266",
                          "priceRangeMin1": "3242.171015",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2024-07-24T00:00:00.000Z,
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287576366956",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "1.346749348905999398",
                          "totalUnderlyingAmount1": "4850.999579",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "154.827449",
                          "underlyingMainAmount0": "1.347136843885842153",
                          "underlyingMainAmount1": "4697.529447",
                        },
                        {
                          "blockTimestamp": 2024-07-24T00:32:09.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-604800-1721520000",
                          "managerTotalSupply": "0.000000009498571634",
                          "nativeToUSDPrice": "3477.19247789",
                          "outputToNativePrices": [],
                          "period": 604800n,
                          "priceOfToken0InToken1": "3477.579505",
                          "priceRangeMax1": "3729.358266",
                          "priceRangeMin1": "3242.171015",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2024-07-21T00:00:00.000Z,
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287576366956",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "1.346749348905999398",
                          "totalUnderlyingAmount1": "4850.999579",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "154.827449",
                          "underlyingMainAmount0": "1.347136843885842153",
                          "underlyingMainAmount1": "4697.529447",
                        },
                      ],
                    },
                    "ClmStrategy": {
                      "sets": [
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17495891n,
                          "initializedTimestamp": 2024-07-24T00:32:09.000Z,
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "ClmWithdrawEvent": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "amount0": "0.137096824193939866",
                          "amount1": "493.823618",
                          "blockNumber": 17495891n,
                          "blockTimestamp": 2024-07-24T00:32:09.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x982f321d7cf4048fa7cff6a39990441d8b67126e4be9b7b55923c68f7defe39c-0-193",
                          "logIndex": 193,
                          "shares": "0.000000000966938656",
                          "trxHash": "0x982f321d7cf4048fa7cff6a39990441d8b67126e4be9b7b55923c68f7defe39c",
                          "trxIndex": 0,
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
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
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
                        },
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "contract": "ClmStrategy",
                        },
                      ],
                    },
                    "block": 17495891,
                    "chainId": 8453,
                    "eventsProcessed": 5,
                  },
                ],
              }
            `);
        });
    });

    describe('Transfer with initialized CLM', () => {
        const userA = '0x94b32bdb9ff47f3239f04514bce862c7d95600ca';
        const userB = '0x515e02402b7a3f67551763206d12cbde2d98766f';
        const trxHash = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
        const trxIdx = 5;

        it('Should create ClmPosition and ClmPositionInteraction when Transfer is emitted on initialized CLM', async () => {
            const indexer = createTestIndexer();
            const block = { number: BASE_DEPOSIT.blockNum, timestamp: BASE_DEPOSIT.timestampSec };

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initBaseClmSim({
                                blockNum: block.number,
                                timestampSec: block.timestamp,
                            }),
                            {
                                contract: 'ClmManager',
                                event: 'Transfer',
                                srcAddress: MANAGER_BASE,
                                params: {
                                    from: userA,
                                    to: userB,
                                    value: parseUnits('1', 18),
                                },
                                ...eventMeta({
                                    block,
                                    trxHash,
                                    trxIndex: trxIdx,
                                    logIndex: 10,
                                }),
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create ClmPosition and ClmPositionInteraction entities for initialized CLM transfer'
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
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": 2024-07-23T00:24:27.000Z,
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0.000000000010342879",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                          "underlyingProtocolPool": "0x57713f7716e0b0f65ec116912f834e49805480d2",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": 2024-07-23T00:24:27.000Z,
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmPosition": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "createdWithTrxHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "managerBalance": "-1",
                          "rewardPoolBalances": [],
                          "totalBalance": "-1",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "createdWithTrxHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "managerBalance": "1",
                          "rewardPoolBalances": [],
                          "totalBalance": "1",
                        },
                      ],
                    },
                    "ClmPositionInteraction": {
                      "sets": [
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "blockNumber": 17452460n,
                          "blockTimestamp": 2024-07-23T00:24:27.000Z,
                          "claimedRewardPool_id": undefined,
                          "clmPosition_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee-5-10-0",
                          "logIndex": 10,
                          "managerBalance": "1",
                          "managerBalanceDelta": "1",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "rewardBalancesDelta": [],
                          "rewardPoolBalances": [],
                          "rewardPoolBalancesDelta": [],
                          "rewardToNativePrices": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBalance": "1",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                          "type": "MANAGER_DEPOSIT",
                          "underlyingBalance0": "145027317.82901056852738971421786912522132377261688935933602",
                          "underlyingBalance0Delta": "145027317.82901056852738971421786912522132377261688935933602",
                          "underlyingBalance1": "500021512385.47796991533981979292226081345435830777871422454038",
                          "underlyingBalance1Delta": "500021512385.47796991533981979292226081345435830777871422454038",
                        },
                      ],
                    },
                    "ClmSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": 2024-07-23T00:24:27.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-3600-1721692800",
                          "managerTotalSupply": "0.000000000010342879",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "period": 3600n,
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2024-07-23T00:00:00.000Z,
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                        },
                        {
                          "blockTimestamp": 2024-07-23T00:24:27.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-86400-1721692800",
                          "managerTotalSupply": "0.000000000010342879",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "period": 86400n,
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2024-07-23T00:00:00.000Z,
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                        },
                        {
                          "blockTimestamp": 2024-07-23T00:24:27.000Z,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-604800-1721520000",
                          "managerTotalSupply": "0.000000000010342879",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "period": 604800n,
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2024-07-21T00:00:00.000Z,
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                        },
                      ],
                    },
                    "ClmStrategy": {
                      "sets": [
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": 2024-07-23T00:24:27.000Z,
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
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
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "1",
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
                          "blockNumber": 17452460n,
                          "blockTimestamp": 2024-07-23T00:24:27.000Z,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452460-5-10",
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
                          "blockNumber": 17452460n,
                          "blockTimestamp": 2024-07-23T00:24:27.000Z,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-17452460-5-10",
                          "logIndex": 10,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "token_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "trxHash": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                          "trxIndex": 5,
                        },
                      ],
                    },
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
                        },
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "contract": "ClmStrategy",
                        },
                      ],
                    },
                    "block": 17452460,
                    "chainId": 8453,
                    "eventsProcessed": 5,
                  },
                ],
              }
            `);
        });
    });
});
