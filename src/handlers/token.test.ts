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
                    1: { startBlock: 22089841, endBlock: 22089841 },
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
                    "blockHash": "0xd542fff60cb5125066683f564bcc5bb565baf5d969ca0f443ff6f7d292232ba0",
                    "chainId": 1,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should not create change entities for zero value transfers, but should detect token entities', async () => {
            const indexer = createTestIndexer();

            // contract creation 18393938, initialized at 18393973
            const initTrace = await indexer.process({
                chains: {
                    1: { startBlock: 18393938, endBlock: 18393973 },
                },
            });
            expect(initTrace.changes.length).toBeGreaterThan(0);

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
            const initTrace = await indexer.process({ chains: { 8453: { startBlock: 19077712, endBlock: 19077718 } } });
            expect(initTrace.changes.length).toBeGreaterThan(0);

            const trace = await indexer.process({
                chains: {
                    // process mint event for 0x020D570516a85C3E47D8D48c17FBcF63053Cc9f5
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

        it.skip('Should update balances for Arbitrum reward pool vault transfer at block 245002875', async () => {
            const indexer = createTestIndexer();

            // Prepare with init traces: vault 0xA297024a99098d52aae466AC5F48520d514262bA (creation 226974285, init 226974336),
            // reward pool 0xfb8d2f93a8bbbebd9ed701386c802705f42be1b1 (creation 227658548, init 227658576).
            // first reward pool stake at 228169368
            // const initTraceVault = await indexer.process({
            //   chains: {
            //     42161: { startBlock: 226974285, endBlock: 226974336 },
            //   },
            // });
            // expect(initTraceVault.changes.length).toBeGreaterThan(0);

            // const initTraceRewardPool = await indexer.process({
            //   chains: {
            //     42161: { startBlock: 227658548, endBlock: 227658576 },
            //   },
            // });
            // expect(initTraceRewardPool.changes.length).toBeGreaterThan(0);

            const trace = await indexer.process({
                chains: {
                    42161: { startBlock: 226974284, endBlock: 228169369 },
                },
            });
            expect(trace.changes).toMatchInlineSnapshot();
        });

        it('Should not decrement holderCount on self-transfer (from === to)', async () => {
            const indexer = createTestIndexer();

            // // contract creation 6067954, strategy creation 6067957, initial deposit 6068114
            // const initTrace = await indexer.process({
            //   chains: {
            //     56: { startBlock: 6067954, endBlock: 6068114 },
            //   },
            // });
            // expect(initTrace.changes.length).toBeGreaterThan(0);

            // Non-zero self-transfer: from=to=0x94342d418137f494bfa8e133cb79e55a3e7dd532,
            // contract 0xba53af4c2f1649f82e8070fb306ddbf2771a1950 (moo1INCH1INCH), amount_raw=26493322047799471367.
            // Without the fix, the same balance would be updated twice (stale second write) and holderCount
            // would be spuriously decremented when balance momentarily touched zero.
            const trace = await indexer.process({
                chains: {
                    // BNB (BSC) chain, block 12132390
                    // tx 0x8a9a3dde3386957af9763ce41a22a1dbd162b9c0e3711e4490e6c30c6d3f6b88
                    56: { startBlock: 12132390, endBlock: 12132390 },
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
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xba53af4c2f1649f82e8070fb306ddbf2771a1950-12132390",
                          "logIndex": 387,
                          "tokenBalance_id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "token_id": "56-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
                          "trxHash": "0x8a9a3dde3386957af9763ce41a22a1dbd162b9c0e3711e4490e6c30c6d3f6b88",
                        },
                      ],
                    },
                    "block": 12132390,
                    "blockHash": "0xe919e67fe66a265e114535cdbb724fd51cd5f30a9d01412154c342c75dfd3700",
                    "chainId": 56,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
