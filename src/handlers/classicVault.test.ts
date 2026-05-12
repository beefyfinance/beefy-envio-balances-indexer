import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ZERO } from '../lib/decimal';

/** BSC vault backed by {@link staticVaults} in classicVault.effects (no live vault multicall). */
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
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "chainId": 56,
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
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "chainId": 56,
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

        it('Should skip blacklisted ClassicVault during initialization', async () => {
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
                                srcAddress: '0x0000000000000000000000000000000000000005',
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
                    "block": 12132390,
                    "chainId": 56,
                    "eventsProcessed": 1,
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

            const trace = await indexer.process({
                chains: {
                    143: {
                        simulate: [
                            {
                                contract: 'ClassicVault',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
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
                    "block": 12132390,
                    "chainId": 143,
                    "eventsProcessed": 1,
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
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "chainId": 56,
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
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "chainId": 56,
                          "decimals": 18,
                          "holderCount": 2,
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
                          "chainId": 56,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "amount": "1",
                          "chainId": 56,
                          "id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
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
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "chainId": 56,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c-12132390-1-50",
                          "logIndex": 50,
                          "tokenBalance_id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 12132390n,
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "chainId": 56,
                          "id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c-12132390-1-50",
                          "logIndex": 50,
                          "tokenBalance_id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
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
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "chainId": 56,
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
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "chainId": 56,
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
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "chainId": 56,
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "isVirtual": false,
                          "name": "Wrapped BNB",
                          "symbol": "WBNB",
                          "totalSupply": "0.1",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "amount": "0.1",
                          "chainId": 56,
                          "id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
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
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "chainId": 56,
                          "id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c-12132390-1-52",
                          "logIndex": 52,
                          "tokenBalance_id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
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
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "chainId": 56,
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
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "chainId": 56,
                          "decimals": 18,
                          "holderCount": 1,
                          "id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "isVirtual": false,
                          "name": "Wrapped BNB",
                          "symbol": "WBNB",
                          "totalSupply": "-0.1",
                        },
                      ],
                    },
                    "TokenBalance": {
                      "sets": [
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "amount": "-0.1",
                          "chainId": 56,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
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
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "chainId": 56,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c-12132390-1-53",
                          "logIndex": 53,
                          "tokenBalance_id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
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
                    "ClassicVault": {
                      "sets": [
                        {
                          "address": "0x6be4741ab0ad233e4315a10bc783a7b923386b71",
                          "chainId": 56,
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
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "chainId": 56,
                          "decimals": 18,
                          "holderCount": 2,
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
                          "chainId": 56,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "amount": "0.5",
                          "chainId": 56,
                          "id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
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
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "chainId": 56,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c-12132390-1-54",
                          "logIndex": 54,
                          "tokenBalance_id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 12132390n,
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "chainId": 56,
                          "id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c-12132390-1-54",
                          "logIndex": 54,
                          "tokenBalance_id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                        {
                          "account_id": "0x1111111111111111111111111111111111111111",
                          "balanceAfter": "0.5",
                          "balanceBefore": "1",
                          "blockNumber": 12132390n,
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "chainId": 56,
                          "id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c-12132390-1-55",
                          "logIndex": 55,
                          "tokenBalance_id": "56-0x1111111111111111111111111111111111111111-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "trxHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          "trxIndex": 1,
                        },
                        {
                          "account_id": "0x94342d418137f494bfa8e133cb79e55a3e7dd532",
                          "balanceAfter": "-0.5",
                          "balanceBefore": "-1",
                          "blockNumber": 12132390n,
                          "blockTimestamp": "2021-10-27T09:56:05.000Z",
                          "chainId": 56,
                          "id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c-12132390-1-55",
                          "logIndex": 55,
                          "tokenBalance_id": "56-0x94342d418137f494bfa8e133cb79e55a3e7dd532-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
                          "token_id": "56-0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
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
