import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ZERO } from '../lib/decimal';
import { FACTORIES, registerClassicVault } from './testFixtures/register';

/** BSC vault backed by {@link staticVaults} in config/classic/staticVaults (no live vault multicall). */
const VAULT_BSC = '0x6be4741ab0ad233e4315a10bc783a7b923386b71' as const;

describe('ClassicVault Handlers', () => {
    const blockNum = 12_132_390;
    const timestampSec = Math.floor(Date.parse('2021-10-27T09:56:05.000Z') / 1000);
    const trxHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const trxIdx = 1;

    describe('Initialized event', () => {
        it('Should create ClassicVault entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    56: {
                        simulate: [
                            {
                                contract: 'ClassicVault',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: VAULT_BSC,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create ClassicVault entity with correct shareToken and underlyingToken'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Classic": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "boostRewardToNativePrices": [],
                          "boostRewardToken_ids": [],
                          "boostRewardTokensOrder": [],
                          "classicVaultStrategy_id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterToken_ids": [],
                          "erc4626AdapterTokensOrder": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "nativeToUSDPrice": "452.83830981",
                          "pausableStatus": "RUNNING",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingBreakdownToken_ids": [],
                          "underlyingBreakdownTokensOrder": [],
                          "underlyingPlatform": "UNKNOWN",
                          "underlyingToNativePrice": "1",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-3600-1635325200",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 3600n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T09:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-86400-1635292800",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 86400n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-604800-1635033600",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 604800n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-24T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "shareToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "isVirtual": false,
                          "name": "Moo Venus BNB",
                          "symbol": "mooVenusBNB",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "isVirtual": false,
                          "name": "Wrapped BNB",
                          "symbol": "WBNB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 12132390,
                    "chainId": 56,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should handle already initialized ClassicVault gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    56: {
                        simulate: [
                            {
                                contract: 'ClassicVault',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 10,
                                srcAddress: VAULT_BSC,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicVault',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 11,
                                srcAddress: VAULT_BSC,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when ClassicVault is already initialized'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Classic": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "boostRewardToNativePrices": [],
                          "boostRewardToken_ids": [],
                          "boostRewardTokensOrder": [],
                          "classicVaultStrategy_id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterToken_ids": [],
                          "erc4626AdapterTokensOrder": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "nativeToUSDPrice": "452.83830981",
                          "pausableStatus": "RUNNING",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingBreakdownToken_ids": [],
                          "underlyingBreakdownTokensOrder": [],
                          "underlyingPlatform": "UNKNOWN",
                          "underlyingToNativePrice": "1",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-3600-1635325200",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 3600n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T09:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-86400-1635292800",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 86400n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-604800-1635033600",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 604800n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-24T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "shareToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "isVirtual": false,
                          "name": "Moo Venus BNB",
                          "symbol": "mooVenusBNB",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "isVirtual": false,
                          "name": "Wrapped BNB",
                          "symbol": "WBNB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 12132390,
                    "chainId": 56,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        it('Should skip blacklisted ClassicVault during initialization', async () => {
            const indexer = createTestIndexer();
            const badVault = '0x0000000000000000000000000000000000000005';
            const block = { number: blockNum, timestamp: timestampSec };

            const trace = await indexer.process({
                chains: {
                    56: {
                        simulate: [
                            registerClassicVault({
                                factory: FACTORIES[56].ClassicVaultFactory,
                                proxy: badVault,
                                block,
                                logIndex: 0,
                            }),
                            {
                                contract: 'ClassicVault',
                                event: 'Initialized',
                                block,
                                logIndex: 1,
                                srcAddress: badVault,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log blacklist status for blacklisted ClassicVault'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x0000000000000000000000000000000000000005",
                          "contract": "ClassicVault",
                        },
                      ],
                    },
                    "block": 12132390,
                    "chainId": 56,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        // Monad chain 143: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 is the Ethereum-mainnet
        // USDC address mistakenly deployed/registered as a vault on monad. Its `want()` succeeds
        // and returns an underlying address, but that returned address is not a valid ERC20 on
        // monad (decimals/name/symbol revert), so it exercises the new `getTokenMetadata` ->
        // `status: 'invalid'` path in `getOrCreateToken`.
        it('Should skip ClassicVault when underlying token metadata is invalid', async () => {
            const indexer = createTestIndexer();
            const badVault = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
            const block = { number: 38_500_000, timestamp: timestampSec };

            const trace = await indexer.process({
                chains: {
                    143: {
                        simulate: [
                            registerClassicVault({
                                factory: FACTORIES[143].ClassicVaultFactory,
                                proxy: badVault,
                                block,
                                logIndex: 0,
                            }),
                            {
                                contract: 'ClassicVault',
                                event: 'Initialized',
                                block,
                                logIndex: 1,
                                srcAddress: badVault,
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
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "addresses": {
                      "sets": [
                        {
                          "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                          "contract": "ClassicVault",
                        },
                      ],
                    },
                    "block": 38500000,
                    "chainId": 143,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });
    });

    describe('Transfer event', () => {
        const userA = '0x94342d418137f494bfa8e133cb79e55a3e7dd532';
        const userB = '0x1111111111111111111111111111111111111111';

        const initSim = {
            contract: 'ClassicVault' as const,
            event: 'Initialized' as const,
            block: { number: blockNum, timestamp: timestampSec },
            logIndex: 0,
            srcAddress: VAULT_BSC,
            params: { version: 1n },
        };

        it('Should update balances when Transfer event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    56: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClassicVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 50,
                                srcAddress: VAULT_BSC,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: userB,
                                    value: 10n ** 18n,
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
                          "address": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                        },
                        {
                          "address": "0x1111111111111111111111111111111111111111",
                          "id": "0x1111111111111111111111111111111111111111",
                        },
                      ],
                    },
                    "Classic": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "boostRewardToNativePrices": [],
                          "boostRewardToken_ids": [],
                          "boostRewardTokensOrder": [],
                          "classicVaultStrategy_id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterToken_ids": [],
                          "erc4626AdapterTokensOrder": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "nativeToUSDPrice": "452.83830981",
                          "pausableStatus": "RUNNING",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingBreakdownToken_ids": [],
                          "underlyingBreakdownTokensOrder": [],
                          "underlyingPlatform": "UNKNOWN",
                          "underlyingToNativePrice": "1",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicPosition": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "boostBalance": "0",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "createdWithTrxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "rewardPoolBalances": [],
                          "totalBalance": "-1",
                          "vaultBalance": "-1",
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "boostBalance": "0",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "createdWithTrxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x1111111111111111111111111111111111111111",
                          "rewardPoolBalances": [],
                          "totalBalance": "1",
                          "vaultBalance": "1",
                        },
                      ],
                    },
                    "ClassicPositionInteraction": {
                      "sets": [
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostBalance": "0",
                          "boostBalanceDelta": "0",
                          "boostRewardBalancesDelta": [],
                          "boostRewardToNativePrices": [],
                          "classicPosition_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x1111111111111111111111111111111111111111",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterBalancesDelta": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdapterVaultSharesBalancesDelta": [],
                          "id": "56-0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-1-50-0",
                          "logIndex": 50,
                          "nativeToUSDPrice": "452.83830981",
                          "rewardBalancesDelta": [],
                          "rewardPoolBalances": [],
                          "rewardPoolBalancesDelta": [],
                          "rewardToNativePrices": [],
                          "totalBalance": "1",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                          "type": "VAULT_DEPOSIT",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultBalance": "1",
                          "vaultBalanceDelta": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingAmount": "33097.101885389597044362",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-3600-1635325200",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 3600n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T09:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-86400-1635292800",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 86400n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-604800-1635033600",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 604800n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-24T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "shareToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "decimals": 18,
                          "holderCount": 2,
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "isVirtual": false,
                          "name": "Moo Venus BNB",
                          "symbol": "mooVenusBNB",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "isVirtual": false,
                          "name": "Wrapped BNB",
                          "symbol": "WBNB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "amount": "-1",
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "amount": "1",
                          "id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71-12132390-1-50",
                          "logIndex": 50,
                          "tokenBalance_id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71-12132390-1-50",
                          "logIndex": 50,
                          "tokenBalance_id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                      ],
                    },
                    "block": 12132390,
                    "chainId": 56,
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
                    56: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClassicVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 51,
                                srcAddress: VAULT_BSC,
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
                    "Classic": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "boostRewardToNativePrices": [],
                          "boostRewardToken_ids": [],
                          "boostRewardTokensOrder": [],
                          "classicVaultStrategy_id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterToken_ids": [],
                          "erc4626AdapterTokensOrder": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "nativeToUSDPrice": "452.83830981",
                          "pausableStatus": "RUNNING",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingBreakdownToken_ids": [],
                          "underlyingBreakdownTokensOrder": [],
                          "underlyingPlatform": "UNKNOWN",
                          "underlyingToNativePrice": "1",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-3600-1635325200",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 3600n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T09:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-86400-1635292800",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 86400n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-604800-1635033600",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 604800n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-24T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "shareToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "isVirtual": false,
                          "name": "Moo Venus BNB",
                          "symbol": "mooVenusBNB",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "isVirtual": false,
                          "name": "Wrapped BNB",
                          "symbol": "WBNB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 12132390,
                    "chainId": 56,
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
                    56: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClassicVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 52,
                                srcAddress: VAULT_BSC,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: ADDRESS_ZERO,
                                    to: userB,
                                    value: 10n ** 17n,
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
                          "address": "0x1111111111111111111111111111111111111111",
                          "id": "0x1111111111111111111111111111111111111111",
                        },
                      ],
                    },
                    "Classic": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "boostRewardToNativePrices": [],
                          "boostRewardToken_ids": [],
                          "boostRewardTokensOrder": [],
                          "classicVaultStrategy_id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterToken_ids": [],
                          "erc4626AdapterTokensOrder": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "nativeToUSDPrice": "452.83830981",
                          "pausableStatus": "RUNNING",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingBreakdownToken_ids": [],
                          "underlyingBreakdownTokensOrder": [],
                          "underlyingPlatform": "UNKNOWN",
                          "underlyingToNativePrice": "1",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicPosition": {
                      "sets": [
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "boostBalance": "0",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "createdWithTrxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x1111111111111111111111111111111111111111",
                          "rewardPoolBalances": [],
                          "totalBalance": "0.1",
                          "vaultBalance": "0.1",
                        },
                      ],
                    },
                    "ClassicPositionInteraction": {
                      "sets": [
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostBalance": "0",
                          "boostBalanceDelta": "0",
                          "boostRewardBalancesDelta": [],
                          "boostRewardToNativePrices": [],
                          "classicPosition_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x1111111111111111111111111111111111111111",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterBalancesDelta": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdapterVaultSharesBalancesDelta": [],
                          "id": "56-0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-1-52-0",
                          "logIndex": 52,
                          "nativeToUSDPrice": "452.83830981",
                          "rewardBalancesDelta": [],
                          "rewardPoolBalances": [],
                          "rewardPoolBalancesDelta": [],
                          "rewardToNativePrices": [],
                          "totalBalance": "0.1",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                          "type": "VAULT_DEPOSIT",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultBalance": "0.1",
                          "vaultBalanceDelta": "0.1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingAmount": "33097.101885389597044362",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-3600-1635325200",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 3600n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T09:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-86400-1635292800",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 86400n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-604800-1635033600",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 604800n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-24T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "shareToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "isVirtual": false,
                          "name": "Moo Venus BNB",
                          "symbol": "mooVenusBNB",
                          "totalSupply": "0.1",
                        },
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "isVirtual": false,
                          "name": "Wrapped BNB",
                          "symbol": "WBNB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "amount": "0.1",
                          "id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "balanceAfter": "0.1",
                          "balanceBefore": "0",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71-12132390-1-52",
                          "logIndex": 52,
                          "tokenBalance_id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                      ],
                    },
                    "block": 12132390,
                    "chainId": 56,
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
                    56: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClassicVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 53,
                                srcAddress: VAULT_BSC,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: ADDRESS_ZERO,
                                    value: 10n ** 17n,
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
                          "address": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                        },
                      ],
                    },
                    "Classic": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "boostRewardToNativePrices": [],
                          "boostRewardToken_ids": [],
                          "boostRewardTokensOrder": [],
                          "classicVaultStrategy_id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterToken_ids": [],
                          "erc4626AdapterTokensOrder": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "nativeToUSDPrice": "452.83830981",
                          "pausableStatus": "RUNNING",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingBreakdownToken_ids": [],
                          "underlyingBreakdownTokensOrder": [],
                          "underlyingPlatform": "UNKNOWN",
                          "underlyingToNativePrice": "1",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicPosition": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "boostBalance": "0",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "createdWithTrxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "rewardPoolBalances": [],
                          "totalBalance": "-0.1",
                          "vaultBalance": "-0.1",
                        },
                      ],
                    },
                    "ClassicPositionInteraction": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostBalance": "0",
                          "boostBalanceDelta": "0",
                          "boostRewardBalancesDelta": [],
                          "boostRewardToNativePrices": [],
                          "classicPosition_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterBalancesDelta": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdapterVaultSharesBalancesDelta": [],
                          "id": "56-0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-1-53-0",
                          "logIndex": 53,
                          "nativeToUSDPrice": "452.83830981",
                          "rewardBalancesDelta": [],
                          "rewardPoolBalances": [],
                          "rewardPoolBalancesDelta": [],
                          "rewardToNativePrices": [],
                          "totalBalance": "-0.1",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                          "type": "VAULT_WITHDRAW",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultBalance": "-0.1",
                          "vaultBalanceDelta": "-0.1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingAmount": "33097.101885389597044362",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-3600-1635325200",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 3600n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T09:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-86400-1635292800",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 86400n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-604800-1635033600",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 604800n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-24T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "shareToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "isVirtual": false,
                          "name": "Moo Venus BNB",
                          "symbol": "mooVenusBNB",
                          "totalSupply": "-0.1",
                        },
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "isVirtual": false,
                          "name": "Wrapped BNB",
                          "symbol": "WBNB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "amount": "-0.1",
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "balanceAfter": "-0.1",
                          "balanceBefore": "0",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71-12132390-1-53",
                          "logIndex": 53,
                          "tokenBalance_id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                      ],
                    },
                    "block": 12132390,
                    "chainId": 56,
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
                    56: {
                        simulate: [
                            initSim,
                            {
                                contract: 'ClassicVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 54,
                                srcAddress: VAULT_BSC,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: userB,
                                    value: 10n ** 18n,
                                },
                            },
                            {
                                contract: 'ClassicVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 55,
                                srcAddress: VAULT_BSC,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userB,
                                    to: userA,
                                    value: 5n * 10n ** 17n,
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
                          "address": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                        },
                        {
                          "address": "0x1111111111111111111111111111111111111111",
                          "id": "0x1111111111111111111111111111111111111111",
                        },
                      ],
                    },
                    "Classic": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "boostRewardToNativePrices": [],
                          "boostRewardToken_ids": [],
                          "boostRewardTokensOrder": [],
                          "classicVaultStrategy_id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterToken_ids": [],
                          "erc4626AdapterTokensOrder": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "nativeToUSDPrice": "452.83830981",
                          "pausableStatus": "RUNNING",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingBreakdownToken_ids": [],
                          "underlyingBreakdownTokensOrder": [],
                          "underlyingPlatform": "UNKNOWN",
                          "underlyingToNativePrice": "1",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicPosition": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "boostBalance": "0",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "createdWithTrxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "rewardPoolBalances": [],
                          "totalBalance": "-0.5",
                          "vaultBalance": "-0.5",
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "boostBalance": "0",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "createdWithTrxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x1111111111111111111111111111111111111111",
                          "rewardPoolBalances": [],
                          "totalBalance": "0.5",
                          "vaultBalance": "0.5",
                        },
                      ],
                    },
                    "ClassicPositionInteraction": {
                      "sets": [
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostBalance": "0",
                          "boostBalanceDelta": "0",
                          "boostRewardBalancesDelta": [],
                          "boostRewardToNativePrices": [],
                          "classicPosition_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x1111111111111111111111111111111111111111",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterBalancesDelta": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdapterVaultSharesBalancesDelta": [],
                          "id": "56-0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-1-54-0",
                          "logIndex": 54,
                          "nativeToUSDPrice": "452.83830981",
                          "rewardBalancesDelta": [],
                          "rewardPoolBalances": [],
                          "rewardPoolBalancesDelta": [],
                          "rewardToNativePrices": [],
                          "totalBalance": "1",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                          "type": "VAULT_DEPOSIT",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultBalance": "1",
                          "vaultBalanceDelta": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingAmount": "33097.101885389597044362",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostBalance": "0",
                          "boostBalanceDelta": "0",
                          "boostRewardBalancesDelta": [],
                          "boostRewardToNativePrices": [],
                          "classicPosition_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterBalances": [],
                          "erc4626AdapterBalancesDelta": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdapterVaultSharesBalancesDelta": [],
                          "id": "56-0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-1-55-0",
                          "logIndex": 55,
                          "nativeToUSDPrice": "452.83830981",
                          "rewardBalancesDelta": [],
                          "rewardPoolBalances": [],
                          "rewardPoolBalancesDelta": [],
                          "rewardToNativePrices": [],
                          "totalBalance": "-0.5",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                          "type": "VAULT_DEPOSIT",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultBalance": "-0.5",
                          "vaultBalanceDelta": "0.5",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingAmount": "33097.101885389597044362",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-3600-1635325200",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 3600n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T09:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-86400-1635292800",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 86400n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-27T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "boostRewardToNativePrices": [],
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-604800-1635033600",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 604800n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": 2021-10-24T00:00:00.000Z,
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "shareToken_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": 2021-10-27T09:56:05.000Z,
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "decimals": 18,
                          "holderCount": 2,
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "isVirtual": false,
                          "name": "Moo Venus BNB",
                          "symbol": "mooVenusBNB",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "isVirtual": false,
                          "name": "Wrapped BNB",
                          "symbol": "WBNB",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "amount": "-0.5",
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "amount": "0.5",
                          "id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71-12132390-1-54",
                          "logIndex": 54,
                          "tokenBalance_id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71-12132390-1-54",
                          "logIndex": 54,
                          "tokenBalance_id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "balanceAfter": "0.5",
                          "balanceBefore": "1",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71-12132390-1-55",
                          "logIndex": 55,
                          "tokenBalance_id": "56-0x1111111111111111111111111111111111111111-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "balanceAfter": "-0.5",
                          "balanceBefore": "-1",
                          "blockNumber": 12132390n,
                          "blockTimestamp": 2021-10-27T09:56:05.000Z,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71-12132390-1-55",
                          "logIndex": 55,
                          "tokenBalance_id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "token_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                      ],
                    },
                    "block": 12132390,
                    "chainId": 56,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });
    });
});
