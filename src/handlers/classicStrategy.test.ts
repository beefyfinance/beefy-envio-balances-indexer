import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

/** Same BSC pair as {@link staticVaults} in classicVault.effects. */
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
