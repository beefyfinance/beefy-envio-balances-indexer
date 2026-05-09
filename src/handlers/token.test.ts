import { createTestIndexer } from 'envio';
import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ZERO } from '../lib/decimal';

describe('Token Handlers', () => {
    describe('Initialized event', () => {
        it('Should create Token entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            // Creation tx: https://basescan.org/tx/0x24f6a84238540db8fa3afee33ea6e0f2cde348a5a4d4eecaec587efd02e62fff
            // Initialized tx: https://basescan.org/tx/0xe04b64d5fd209c440a8150441139c1d4bafb5b2b2b907312458458d131f3e969
            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmManagerFactory',
                                event: 'ClmManagerCreated',
                                block: { number: 17_452_329, timestamp: 1718500000 },
                                logIndex: 0,
                                srcAddress: '0x7bc78990ac1ef0754cfde935b2d84e9acf13ed29',
                                params: { proxy: '0x603492ff8943f5ac69aa69cf09fc96fda2606ee7' },
                            },
                            {
                                contract: 'Token',
                                event: 'Initialized',
                                block: { number: 17_452_334, timestamp: 1718500600 },
                                logIndex: 0,
                                srcAddress: '0x603492ff8943f5ac69aa69cf09fc96fda2606ee7',
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should create Token entity with correct address and chainId').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract": "ClmManager",
                        },
                      ],
                    },
                    "block": 17452329,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                  {
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
    });

    describe('Transfer event', () => {
        it('Should update balances when Transfer event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    1: {
                        simulate: [
                            // https://etherscan.io/tx/0x519bac361b822c2f8e1902cd3d1fdab34729075854f2c6e59458b3c9fbea75d1
                            {
                                contract: 'Token',
                                event: 'Transfer',
                                block: {
                                    number: 22_089_841,
                                    timestamp: Math.floor(Date.parse('2025-03-20T18:22:23.000Z') / 1000),
                                },
                                logIndex: 511,
                                srcAddress: '0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1',
                                transaction: {
                                    hash: '0x519bac361b822c2f8e1902cd3d1fdab34729075854f2c6e59458b3c9fbea75d1',
                                    transactionIndex: 121,
                                },
                                params: {
                                    from: '0x94b32bdb9ff47f3239f04514bce862c7d95600ca',
                                    to: '0x515e02402b7a3f67551763206d12cbde2d98766f',
                                    value: parseUnits('10', 18),
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
                    "Token": {
                      "sets": [
                        {
                          "address": "0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 2,
                          "id": "1-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "isVirtual": false,
                          "name": "Beefy",
                          "symbol": "BIFI",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "amount": "-10",
                          "chainId": 1,
                          "id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "token_id": "1-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "10",
                          "chainId": 1,
                          "id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "token_id": "1-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-10",
                          "balanceBefore": "0",
                          "blockNumber": 22089841n,
                          "blockTimestamp": "2025-03-20T18:22:23.000Z",
                          "chainId": 1,
                          "id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1-22089841-121-511",
                          "logIndex": 511,
                          "tokenBalance_id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "token_id": "1-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "trxHash": "0x519bac361b822c2f8e1902cd3d1fdab34729075854f2c6e59458b3c9fbea75d1",
                          "trxIndex": 121,
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "10",
                          "balanceBefore": "0",
                          "blockNumber": 22089841n,
                          "blockTimestamp": "2025-03-20T18:22:23.000Z",
                          "chainId": 1,
                          "id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1-22089841-121-511",
                          "logIndex": 511,
                          "tokenBalance_id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "token_id": "1-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "trxHash": "0x519bac361b822c2f8e1902cd3d1fdab34729075854f2c6e59458b3c9fbea75d1",
                          "trxIndex": 121,
                        },
                      ],
                    },
                    "block": 22089841,
                    "chainId": 1,
                    "eventsProcessed": 1,
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
                            {
                                contract: 'Token',
                                event: 'Initialized',
                                block: { number: 19_077_712, timestamp: 1712000000 },
                                logIndex: 0,
                                srcAddress: '0x020d570516a85c3e47d8d48c17fbcf63053cc9f5',
                                params: { version: 1n },
                            },
                            {
                                contract: 'Token',
                                event: 'Transfer',
                                block: { number: 32_339_635, timestamp: 1719900000 },
                                logIndex: 1,
                                srcAddress: '0x020d570516a85c3e47d8d48c17fbcf63053cc9f5',
                                transaction: {
                                    hash: '0xd7b83bfd594af70b73bae313752f252b4beda8afb97709ed1a586181563b079e',
                                    transactionIndex: 4,
                                },
                                params: {
                                    from: ADDRESS_ZERO,
                                    to: '0xc29d2531651fcd304c60fbfb8073a518d8fe0a21',
                                    value: parseUnits('1', 18),
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
                    "block": 19077712,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                  {
                    "Account": {
                      "sets": [
                        {
                          "address": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x020d570516a85c3e47d8d48c17fbcf63053cc9f5",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "8453-0x020d570516a85c3e47d8d48c17fbcf63053cc9f5",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDbC",
                          "symbol": "cowSushiBaseWETH-USDbC",
                          "totalSupply": "1",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "amount": "1",
                          "chainId": 8453,
                          "id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x020d570516a85c3e47d8d48c17fbcf63053cc9f5",
                          "token_id": "8453-0x020d570516a85c3e47d8d48c17fbcf63053cc9f5",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0xc29d2531651fcd304c60fbfb8073a518d8fe0a21",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 32339635n,
                          "blockTimestamp": "2024-07-02T06:00:00.000Z",
                          "chainId": 8453,
                          "id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x020d570516a85c3e47d8d48c17fbcf63053cc9f5-32339635-4-1",
                          "logIndex": 1,
                          "tokenBalance_id": "8453-0xc29d2531651fcd304c60fbfb8073a518d8fe0a21-0x020d570516a85c3e47d8d48c17fbcf63053cc9f5",
                          "token_id": "8453-0x020d570516a85c3e47d8d48c17fbcf63053cc9f5",
                          "trxHash": "0xd7b83bfd594af70b73bae313752f252b4beda8afb97709ed1a586181563b079e",
                          "trxIndex": 4,
                        },
                      ],
                    },
                    "block": 32339635,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should not decrement holderCount on self-transfer (from === to)', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    56: {
                        simulate: [
                            {
                                contract: 'ClassicVault',
                                event: 'Initialized',
                                block: {
                                    number: 12_132_390,
                                    timestamp: Math.floor(Date.parse('2021-10-27T09:56:05.000Z') / 1000),
                                },
                                logIndex: 0,
                                srcAddress: '0xba53af4c2f1649f82e8070fb306ddbf2771a1950',
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClassicVault',
                                event: 'Transfer',
                                block: {
                                    number: 12_132_390,
                                    timestamp: Math.floor(Date.parse('2021-10-27T09:56:05.000Z') / 1000),
                                },
                                logIndex: 387,
                                srcAddress: '0xba53af4c2f1649f82e8070fb306ddbf2771a1950',
                                transaction: {
                                    hash: '0x8a9a3dde3386957af9763ce41a22a1dbd162b9c0e3711e4490e6c30c6d3f6b88',
                                    transactionIndex: 164,
                                },
                                params: {
                                    from: '0x94342d418137f494bfa8e133cb79e55a3e7dd532',
                                    to: '0x94342d418137f494bfa8e133cb79e55a3e7dd532',
                                    value: 26493322047799471367n,
                                },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should process block with non-zero self-transfer without incorrectly decrementing holderCount'
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
                      ],
                    },
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "chainId": 56,
                          "id": "56-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": "2021-10-27T09:56:05.000Z",
                          "shareToken_id": "56-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "underlyingToken_id": "56-0x111111111117dc0aa78b770fa6a738034120c302",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0xe807517273De0161D8309BC9363193f2162b9B65",
                          "chainId": 56,
                          "classicVault_id": "56-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "id": "56-0xe807517273de0161d8309bc9363193f2162b9b65",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 12132390n,
                          "initializedTimestamp": "2021-10-27T09:56:05.000Z",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "chainId": 56,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "isVirtual": false,
                          "name": "Moo 1INCH 1INCH",
                          "symbol": "moo1INCH1INCH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x111111111117dC0aa78b770fA6A738034120C302",
                          "chainId": 56,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "56-0x111111111117dc0aa78b770fa6a738034120c302",
                          "isVirtual": false,
                          "name": "1INCH Token",
                          "symbol": "1INCH",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "amount": "0",
                          "chainId": 56,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "token_id": "56-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "balanceAfter": "0",
                          "balanceBefore": "0",
                          "blockNumber": 12132390n,
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "chainId": 56,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xba53af4c2f1649f82e8070fb306ddbf2771a1950-12132390-164-387",
                          "logIndex": 387,
                          "tokenBalance_id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "token_id": "56-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "trxHash": "0x8a9a3dde3386957af9763ce41a22a1dbd162b9c0e3711e4490e6c30c6d3f6b88",
                          "trxIndex": 164,
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
    });
});
