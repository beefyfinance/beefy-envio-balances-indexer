import { createTestIndexer } from 'generated';
import { describe, expect, it } from 'vitest';

describe('Token Handlers', () => {
    describe('Initialized event', () => {
        it('Should create Token entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        // Creation of CLM 0x603492ff8943f5ac69aa69cf09fc96fda2606ee7
                        // https://basescan.org/tx/0x24f6a84238540db8fa3afee33ea6e0f2cde348a5a4d4eecaec587efd02e62fff
                        startBlock: 17452329,
                        // Initialized event for CLM 0x603492ff8943f5ac69aa69cf09fc96fda2606ee7
                        // https://basescan.org/tx/0xe04b64d5fd209c440a8150441139c1d4bafb5b2b2b907312458458d131f3e969
                        endBlock: 17452334,
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should create Token entity with correct address and chainId').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 17452329,
                    "chainId": 8453,
                    "dynamic_contract_registry": {
                      "sets": [
                        {
                          "chain_id": 8453,
                          "contract_address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "contract_name": "ClmManager",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "registering_event_block_number": 17452329,
                          "registering_event_block_timestamp": 1721694005,
                          "registering_event_contract_name": "ClmManagerFactory",
                          "registering_event_log_index": 210,
                          "registering_event_name": "ClmManagerCreated",
                          "registering_event_src_address": "0x7bc78990ac1ef0754cfde935b2d84e9acf13ed29",
                        },
                      ],
                    },
                    "eventsProcessed": 1,
                  },
                  {
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452334n,
                          "initializedTimestamp": "2024-07-23T00:20:15.000Z",
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
                    "blockHash": "0x799d550a25bc565a42d19565db06680988c0ae3e715da3781378da9d59af5200",
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
                    // transfer from wallet to wallet
                    // https://etherscan.io/tx/0x519bac361b822c2f8e1902cd3d1fdab34729075854f2c6e59458b3c9fbea75d1
                    1: { startBlock: 22089841, endBlock: 22089842 },
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
                          "id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1-22089841",
                          "logIndex": 511,
                          "tokenBalance_id": "1-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "token_id": "1-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "trxHash": "0x519bac361b822c2f8e1902cd3d1fdab34729075854f2c6e59458b3c9fbea75d1",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "10",
                          "balanceBefore": "0",
                          "blockNumber": 22089841n,
                          "blockTimestamp": "2025-03-20T18:22:23.000Z",
                          "chainId": 1,
                          "id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1-22089841",
                          "logIndex": 511,
                          "tokenBalance_id": "1-0x515e02402b7a3f67551763206d12cbde2d98766f-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "token_id": "1-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "trxHash": "0x519bac361b822c2f8e1902cd3d1fdab34729075854f2c6e59458b3c9fbea75d1",
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

        it('Should not create change entities for zero value transfers, but should detect token entities', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    // https://etherscan.io/tx/0xf9fa2bc521c0ecff3bb9c527b3e386849f6bdea185650e60152818199223c2cc
                    1: { startBlock: 19205168, endBlock: 19205168 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should not create change entities for zero value transfers, but should detect token entities'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0xbeef8e0982874e0292e6c5751c5a4092b3e1beef",
                          "chainId": 1,
                          "id": "1-0xbeef8e0982874e0292e6c5751c5a4092b3e1beef",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 19205168n,
                          "initializedTimestamp": "2024-02-11T13:38:11.000Z",
                          "shareToken_id": "1-0xbeef8e0982874e0292e6c5751c5a4092b3e1beef",
                          "underlyingToken_id": "1-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                        },
                      ],
                    },
                    "ClassicVaultStrategy": {
                      "sets": [
                        {
                          "address": "0xDEF1be4D80a990847f8C7A1e15e824fF2749C0DE",
                          "chainId": 1,
                          "classicVault_id": "1-0xbeef8e0982874e0292e6c5751c5a4092b3e1beef",
                          "id": "1-0xdef1be4d80a990847f8c7a1e15e824ff2749c0de",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 19205168n,
                          "initializedTimestamp": "2024-02-11T13:38:11.000Z",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0xb1f1ee126e9c96231cc3d3fad7c08b4cf873b1f1",
                          "isVirtual": false,
                          "name": "Beefy",
                          "symbol": "BIFI",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0xbeef8e0982874e0292e6c5751c5a4092b3e1beef",
                          "chainId": 1,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "1-0xbeef8e0982874e0292e6c5751c5a4092b3e1beef",
                          "isVirtual": false,
                          "name": "Moo BIFI",
                          "symbol": "mooBIFI",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "block": 19205168,
                    "blockHash": "0x33a58c465c296ac304614327cd2c4492b72f3659e5b92ca63b51923db13c7eaf",
                    "chainId": 1,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        it.skip('Should handle mint transfers (from zero address) correctly', async () => {
            const indexer = createTestIndexer();

            // process event creation + Initialize event for 0x020d570516a85c3e47d8d48c17fbcf63053cc9f5
            await indexer.process({ chains: { 1: { startBlock: 19077712, endBlock: 19077718 } } });

            const trace = await indexer.process({
                chains: {
                    // process mint event
                    // https://basescan.org/tx/0xd7b83bfd594af70b73bae313752f252b4beda8afb97709ed1a586181563b079e
                    8453: { startBlock: 32339635, endBlock: 32339635 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should correctly handle mint transfers from zero address').toMatchInlineSnapshot();
        });

        it.skip('Should handle burn transfers (to zero address) correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    // https://basescan.org/tx/0xeb41baf687582b8ceb51c2b12350759ddcec278db0f56dee7ac5981369dc80a5
                    8453: { startBlock: 32341183, endBlock: 32341183 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should correctly handle burn transfers to zero address').toMatchInlineSnapshot();
        });

        it.skip('Should handle large value transfers correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 13014756, endBlock: 13014756 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should correctly handle transfers with very large values').toMatchInlineSnapshot();
        });

        it.skip('Should handle multiple transfers in the same block correctly', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: { startBlock: 13014756, endBlock: 13014756 },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should process multiple Transfer events in the same block correctly'
            ).toMatchInlineSnapshot();
        });
    });
});
