import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ZERO } from '../lib/decimal';
import { FACTORIES, registerErc4626Adapter } from './testFixtures/register';

describe('Erc4626Adapter Handlers', () => {
    const adapterAddr = '0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5' as const;
    const adapterAddr2 = '0xd5dbbd88dd9f57e8220c8b02bb20bc50ce84b848' as const;
    const blockInit = 13521369;
    const tsInit = Math.floor(Date.parse('2024-04-23T00:28:05.000Z') / 1000);
    const blockDup = 13522734;
    const tsDup = Math.floor(Date.parse('2024-04-23T08:00:00.000Z') / 1000);
    const trxHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const trxIdx = 3;

    describe('Initialized event', () => {
        it('Should create ClassicErc4626Adapter entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            registerErc4626Adapter({
                                factory: FACTORIES[8453].Erc4626AdapterFactory,
                                proxy: adapterAddr,
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 0,
                            }),
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Initialized',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 1,
                                srcAddress: adapterAddr,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create ClassicErc4626Adapter entity with correct shareToken and underlyingToken'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClassicErc4626Adapter": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "classic_id": undefined,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 13521369n,
                          "initializedTimestamp": 2024-04-23T00:28:05.000Z,
                          "shareToken_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "underlyingToken_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "decimals": 6,
                          "holderCount": 0,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "isVirtual": false,
                          "name": "WMoo Compound Base USDC",
                          "symbol": "wmooCompoundBaseUSDC",
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
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "contract": "Erc4626Adapter",
                        },
                      ],
                    },
                    "block": 13521369,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        it('Should handle already initialized ClassicErc4626Adapter gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            registerErc4626Adapter({
                                factory: FACTORIES[8453].Erc4626AdapterFactory,
                                proxy: adapterAddr2,
                                block: { number: blockDup, timestamp: tsDup },
                                logIndex: 0,
                            }),
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Initialized',
                                block: { number: blockDup, timestamp: tsDup },
                                logIndex: 2,
                                srcAddress: adapterAddr2,
                                params: { version: 1n },
                            },
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Initialized',
                                block: { number: blockDup, timestamp: tsDup },
                                logIndex: 1,
                                srcAddress: adapterAddr2,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when ClassicErc4626Adapter is already initialized'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "ClassicErc4626Adapter": {
                      "sets": [
                        {
                          "address": "0xd5dbbd88dd9f57e8220c8b02bb20bc50ce84b848",
                          "classic_id": undefined,
                          "id": "8453-0xd5dbbd88dd9f57e8220c8b02bb20bc50ce84b848",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 13522734n,
                          "initializedTimestamp": 2024-04-23T08:00:00.000Z,
                          "shareToken_id": "8453-0xd5dbbd88dd9f57e8220c8b02bb20bc50ce84b848",
                          "underlyingToken_id": "8453-0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xd5dbbd88dd9f57e8220c8b02bb20bc50ce84b848",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0xd5dbbd88dd9f57e8220c8b02bb20bc50ce84b848",
                          "isVirtual": false,
                          "name": "WMoo Sonne cbETH",
                          "symbol": "wmooSonnecbETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22",
                          "isVirtual": false,
                          "name": "Coinbase Wrapped Staked ETH",
                          "symbol": "cbETH",
                          "totalSupply": "0",
                        },
                      ],
                    },
                    "addresses": {
                      "sets": [
                        {
                          "address": "0xd5dbbd88dd9f57e8220c8b02bb20bc50ce84b848",
                          "contract": "Erc4626Adapter",
                        },
                      ],
                    },
                    "block": 13522734,
                    "chainId": 8453,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });

        it('Should skip blacklisted ClassicErc4626Adapter during initialization', async () => {
            const indexer = createTestIndexer();
            // No ERC4626 asset() implementation → effect returns blacklisted (avoid reserved precompile addrs).
            const badAdapter = '0x1111111111111111111111111111111111111111' as const;

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            registerErc4626Adapter({
                                factory: FACTORIES[8453].Erc4626AdapterFactory,
                                proxy: badAdapter,
                                block: { number: 17539954, timestamp: 1719900000 },
                                logIndex: 0,
                            }),
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Initialized',
                                block: { number: 17539954, timestamp: 1719900000 },
                                logIndex: 1,
                                srcAddress: badAdapter,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log blacklist status for blacklisted ClassicErc4626Adapter'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x1111111111111111111111111111111111111111",
                          "contract": "Erc4626Adapter",
                        },
                      ],
                    },
                    "block": 17539954,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        // TODO: find an on-chain Erc4626Adapter where `asset()` succeeds but the returned
        // address is not a valid ERC20 (decimals/name/symbol revert), exercising the
        // `getTokenMetadata -> status: 'invalid'` path in `getOrCreateToken`. Then drop the
        // `.skip`, fill in srcAddress + chainId, and let the inline snapshot regenerate.
        // biome-ignore lint/suspicious/noSkippedTests: intentional placeholder; see TODO above
        it.skip('Should skip ClassicErc4626Adapter when underlying token metadata is invalid', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            registerErc4626Adapter({
                                factory: FACTORIES[8453].Erc4626AdapterFactory,
                                proxy: '0x0000000000000000000000000000000000000000',
                                block: { number: 17539954, timestamp: 1719900000 },
                                logIndex: 0,
                            }),
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Initialized',
                                block: { number: 17539954, timestamp: 1719900000 },
                                logIndex: 1,
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
                            registerErc4626Adapter({
                                factory: FACTORIES[8453].Erc4626AdapterFactory,
                                proxy: adapterAddr,
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 0,
                            }),
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Initialized',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 1,
                                srcAddress: adapterAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Transfer',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 5,
                                srcAddress: adapterAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: userB,
                                    value: 1000000n,
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
                    "ClassicErc4626Adapter": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "classic_id": undefined,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 13521369n,
                          "initializedTimestamp": 2024-04-23T00:28:05.000Z,
                          "shareToken_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "underlyingToken_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "decimals": 6,
                          "holderCount": 2,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "isVirtual": false,
                          "name": "WMoo Compound Base USDC",
                          "symbol": "wmooCompoundBaseUSDC",
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
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "1",
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 13521369n,
                          "blockTimestamp": 2024-04-23T00:28:05.000Z,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5-13521369-3-5",
                          "logIndex": 5,
                          "tokenBalance_id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "trxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          "trxIndex": 3,
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 13521369n,
                          "blockTimestamp": 2024-04-23T00:28:05.000Z,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5-13521369-3-5",
                          "logIndex": 5,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "trxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          "trxIndex": 3,
                        },
                      ],
                    },
                    "addresses": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "contract": "Erc4626Adapter",
                        },
                      ],
                    },
                    "block": 13521369,
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
                            registerErc4626Adapter({
                                factory: FACTORIES[8453].Erc4626AdapterFactory,
                                proxy: adapterAddr,
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 0,
                            }),
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Initialized',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 1,
                                srcAddress: adapterAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Transfer',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 6,
                                srcAddress: adapterAddr,
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
                    "ClassicErc4626Adapter": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "classic_id": undefined,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 13521369n,
                          "initializedTimestamp": 2024-04-23T00:28:05.000Z,
                          "shareToken_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "underlyingToken_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "decimals": 6,
                          "holderCount": 0,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "isVirtual": false,
                          "name": "WMoo Compound Base USDC",
                          "symbol": "wmooCompoundBaseUSDC",
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
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "contract": "Erc4626Adapter",
                        },
                      ],
                    },
                    "block": 13521369,
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
                            registerErc4626Adapter({
                                factory: FACTORIES[8453].Erc4626AdapterFactory,
                                proxy: adapterAddr,
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 0,
                            }),
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Initialized',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 1,
                                srcAddress: adapterAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Transfer',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 7,
                                srcAddress: adapterAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: ADDRESS_ZERO,
                                    to: userB,
                                    value: 2000000n,
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
                    "ClassicErc4626Adapter": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "classic_id": undefined,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 13521369n,
                          "initializedTimestamp": 2024-04-23T00:28:05.000Z,
                          "shareToken_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "underlyingToken_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "decimals": 6,
                          "holderCount": 1,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "isVirtual": false,
                          "name": "WMoo Compound Base USDC",
                          "symbol": "wmooCompoundBaseUSDC",
                          "totalSupply": "2",
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
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "2",
                          "balanceBefore": "0",
                          "blockNumber": 13521369n,
                          "blockTimestamp": 2024-04-23T00:28:05.000Z,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5-13521369-3-7",
                          "logIndex": 7,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "trxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          "trxIndex": 3,
                        },
                      ],
                    },
                    "addresses": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "contract": "Erc4626Adapter",
                        },
                      ],
                    },
                    "block": 13521369,
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
                            registerErc4626Adapter({
                                factory: FACTORIES[8453].Erc4626AdapterFactory,
                                proxy: adapterAddr,
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 0,
                            }),
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Initialized',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 1,
                                srcAddress: adapterAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Transfer',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 8,
                                srcAddress: adapterAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: ADDRESS_ZERO,
                                    value: 1000000n,
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
                    "ClassicErc4626Adapter": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "classic_id": undefined,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 13521369n,
                          "initializedTimestamp": 2024-04-23T00:28:05.000Z,
                          "shareToken_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "underlyingToken_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "decimals": 6,
                          "holderCount": 1,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "isVirtual": false,
                          "name": "WMoo Compound Base USDC",
                          "symbol": "wmooCompoundBaseUSDC",
                          "totalSupply": "-1",
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
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 13521369n,
                          "blockTimestamp": 2024-04-23T00:28:05.000Z,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5-13521369-3-8",
                          "logIndex": 8,
                          "tokenBalance_id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "trxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          "trxIndex": 3,
                        },
                      ],
                    },
                    "addresses": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "contract": "Erc4626Adapter",
                        },
                      ],
                    },
                    "block": 13521369,
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
                            registerErc4626Adapter({
                                factory: FACTORIES[8453].Erc4626AdapterFactory,
                                proxy: adapterAddr,
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 0,
                            }),
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Initialized',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 1,
                                srcAddress: adapterAddr,
                                params: { version: 1n },
                            },
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Transfer',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 9,
                                srcAddress: adapterAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: userB,
                                    value: 1000000n,
                                },
                            },
                            {
                                contract: 'Erc4626Adapter',
                                event: 'Transfer',
                                block: { number: blockInit, timestamp: tsInit },
                                logIndex: 10,
                                srcAddress: adapterAddr,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userB,
                                    to: userA,
                                    value: 500000n,
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
                    "ClassicErc4626Adapter": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "classic_id": undefined,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 13521369n,
                          "initializedTimestamp": 2024-04-23T00:28:05.000Z,
                          "shareToken_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "underlyingToken_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "decimals": 6,
                          "holderCount": 2,
                          "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "isVirtual": false,
                          "name": "WMoo Compound Base USDC",
                          "symbol": "wmooCompoundBaseUSDC",
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
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "amount": "0.5",
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                        },
                      ],
                    },
                    "TokenBalanceChange": {
                      "sets": [
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-1",
                          "balanceBefore": "0",
                          "blockNumber": 13521369n,
                          "blockTimestamp": 2024-04-23T00:28:05.000Z,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5-13521369-3-9",
                          "logIndex": 9,
                          "tokenBalance_id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "trxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          "trxIndex": 3,
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "1",
                          "balanceBefore": "0",
                          "blockNumber": 13521369n,
                          "blockTimestamp": 2024-04-23T00:28:05.000Z,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5-13521369-3-9",
                          "logIndex": 9,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "trxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          "trxIndex": 3,
                        },
                        {
                          "account_id": "0x515e02402b7a3f67551763206d12cbde2d98766f",
                          "balanceAfter": "0.5",
                          "balanceBefore": "1",
                          "blockNumber": 13521369n,
                          "blockTimestamp": 2024-04-23T00:28:05.000Z,
                          "id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5-13521369-3-10",
                          "logIndex": 10,
                          "tokenBalance_id": "8453-0x515e02402b7a3f67551763206d12cbde2d98766f-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "trxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          "trxIndex": 3,
                        },
                        {
                          "account_id": "0x94b32bdb9ff47f3239f04514bce862c7d95600ca",
                          "balanceAfter": "-0.5",
                          "balanceBefore": "-1",
                          "blockNumber": 13521369n,
                          "blockTimestamp": 2024-04-23T00:28:05.000Z,
                          "id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5-13521369-3-10",
                          "logIndex": 10,
                          "tokenBalance_id": "8453-0x94b32bdb9ff47f3239f04514bce862c7d95600ca-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "token_id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "trxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          "trxIndex": 3,
                        },
                      ],
                    },
                    "addresses": {
                      "sets": [
                        {
                          "address": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
                          "contract": "Erc4626Adapter",
                        },
                      ],
                    },
                    "block": 13521369,
                    "chainId": 8453,
                    "eventsProcessed": 4,
                  },
                ],
              }
            `);
        });
    });
});
