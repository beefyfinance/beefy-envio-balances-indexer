import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

/** Same BSC pair as {@link staticVaults} in config/classic/staticVaults. */
const VAULT_BSC = '0x6be4741ab0ad233e4315a10bc783a7b923386b71' as const;
const STRATEGY_BSC = '0x83dfd1c2f553e8026ea8626399fe26ce419dfdac' as const;

describe('ClassicStrategy Handlers', () => {
    const blockNum = 12_132_390;
    const timestampSec = Math.floor(Date.parse('2021-10-27T09:56:05.000Z') / 1000);

    describe('Initialized event', () => {
        it('Should create ClassicVaultStrategy entity when Initialized event is emitted', async () => {
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
                            {
                                contract: 'ClassicStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 1,
                                srcAddress: STRATEGY_BSC,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create ClassicVaultStrategy entity linked to existing ClassicVault'
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
                          "chainId": 56,
                          "classicVaultStrategy_id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterToken_ids": [],
                          "erc4626AdapterTokensOrder": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": "2021-10-27T09:56:05.000Z",
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
                          "underlyingBreakdownToNativePrices": [
                            "0",
                          ],
                          "underlyingBreakdownToken_ids": [
                            "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          ],
                          "underlyingBreakdownTokensOrder": [
                            "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          ],
                          "underlyingPlatform": "UNKNOWN",
                          "underlyingToNativePrice": "1",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [
                            "33097.101885389597044362",
                          ],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "boostRewardToNativePrices": [],
                          "chainId": 56,
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-3600-1635325200",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 3600n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2021-10-27T09:00:00.000Z",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [
                            "0",
                          ],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [
                            "33097.101885389597044362",
                          ],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "boostRewardToNativePrices": [],
                          "chainId": 56,
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-86400-1635292800",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 86400n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2021-10-27T00:00:00.000Z",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [
                            "0",
                          ],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [
                            "33097.101885389597044362",
                          ],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "boostRewardToNativePrices": [],
                          "chainId": 56,
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-604800-1635033600",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 604800n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2021-10-24T00:00:00.000Z",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [
                            "0",
                          ],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [
                            "33097.101885389597044362",
                          ],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "chainId": 56,
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": "2021-10-27T09:56:05.000Z",
                          "shareToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "chainId": 56,
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": "2021-10-27T09:56:05.000Z",
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "chainId": 56,
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

        it('Should handle already initialized ClassicStrategy gracefully', async () => {
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
                            {
                                contract: 'ClassicStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 1,
                                srcAddress: STRATEGY_BSC,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 2,
                                srcAddress: STRATEGY_BSC,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when ClassicStrategy is already initialized'
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
                          "chainId": 56,
                          "classicVaultStrategy_id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterToken_ids": [],
                          "erc4626AdapterTokensOrder": [],
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": "2021-10-27T09:56:05.000Z",
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
                          "underlyingBreakdownToNativePrices": [
                            "0",
                          ],
                          "underlyingBreakdownToken_ids": [
                            "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          ],
                          "underlyingBreakdownTokensOrder": [
                            "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          ],
                          "underlyingPlatform": "UNKNOWN",
                          "underlyingToNativePrice": "1",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [
                            "33097.101885389597044362",
                          ],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "boostRewardToNativePrices": [],
                          "chainId": 56,
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-3600-1635325200",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 3600n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2021-10-27T09:00:00.000Z",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [
                            "0",
                          ],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [
                            "33097.101885389597044362",
                          ],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "boostRewardToNativePrices": [],
                          "chainId": 56,
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-86400-1635292800",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 86400n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2021-10-27T00:00:00.000Z",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [
                            "0",
                          ],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [
                            "33097.101885389597044362",
                          ],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                        {
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "boostRewardToNativePrices": [],
                          "chainId": 56,
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "erc4626AdapterVaultSharesBalances": [],
                          "erc4626AdaptersTotalSupply": [],
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71-604800-1635033600",
                          "nativeToUSDPrice": "452.83830981",
                          "period": 604800n,
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2021-10-24T00:00:00.000Z",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "underlyingAmount": "33097.101885389597044362",
                          "underlyingBreakdownToNativePrices": [
                            "0",
                          ],
                          "underlyingToNativePrice": "1",
                          "vaultTokenTotalSupply": "29210.651230859169772152",
                          "vaultUnderlyingBalance": "33097.101885389597044362",
                          "vaultUnderlyingBreakdownBalances": [
                            "33097.101885389597044362",
                          ],
                          "vaultUnderlyingTotalSupply": "6912581.875114755319058026",
                        },
                      ],
                    },
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "chainId": 56,
                          "classic_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": "2021-10-27T09:56:05.000Z",
                          "shareToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "underlyingToken_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "chainId": 56,
                          "classicVault_id": "56-0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "id": "56-0x83dfd1c2f553e8026ea8626399fe26ce419dfdac",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": "2021-10-27T09:56:05.000Z",
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "chainId": 56,
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
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });

        it('Should skip ClassicStrategy with zero address vault', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicStrategy',
                                event: 'Initialized',
                                block: { number: 21_890_07, timestamp: 1715373000 },
                                logIndex: 0,
                                srcAddress: '0x0000000000000000000000000000000000000007',
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should return null and log error when vault address is zero').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 2189007,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should skip ClassicStrategy when parent ClassicVault does not exist', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    56: {
                        simulate: [
                            {
                                contract: 'ClassicStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: STRATEGY_BSC,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log warning when ClassicVault parent entity does not exist'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 12132390,
                    "chainId": 56,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
