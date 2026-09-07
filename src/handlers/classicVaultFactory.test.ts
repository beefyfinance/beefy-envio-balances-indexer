import { createTestIndexer } from 'envio';
import { encodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import { classicVaultFactoryAbi } from '../effects/abis/beefy/classic/ClassicVaultFactory';

describe('ClassicVaultFactory Handlers', () => {
    describe('VaultOrStrategyCreated event', () => {
        it('Should register ClassicVault when VaultOrStrategyCreated event detects a vault', async () => {
            const indexer = createTestIndexer();

            // Tx pattern: https://basescan.org/tx/0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2
            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicVaultFactory',
                                block: { number: 2189005, timestamp: 1715372800 },
                                logIndex: 0,
                                srcAddress: '0xbc4a342b0c057501e081484a2d24e576e854f823',
                                transaction: {
                                    hash: '0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2',
                                    input: encodeFunctionData({
                                        abi: classicVaultFactoryAbi,
                                        functionName: 'cloneVault',
                                        args: [],
                                    }),
                                },
                                event: 'VaultOrStrategyCreated',
                                params: { proxy: '0x00000000000000000000000000000000deadbeef' },
                            },
                        ],
                    },
                },
            });

            expect(trace).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x00000000000000000000000000000000deadbeef",
                          "contract": "ClassicVault",
                        },
                      ],
                    },
                    "block": 2189005,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should register ClassicBoost when VaultOrStrategyCreated event detects a boost', async () => {
            const indexer = createTestIndexer();

            // Tx pattern: https://basescan.org/tx/0xd5f31b6ea5c1bffc7a50e46ae558d6937c08e5733b83d6bef4b05888faa9bfac
            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicVaultFactory',
                                block: { number: 2189006, timestamp: 1715372900 },
                                logIndex: 0,
                                srcAddress: '0xbc4a342b0c057501e081484a2d24e576e854f823',
                                transaction: {
                                    hash: '0xd5f31b6ea5c1bffc7a50e46ae558d6937c08e5733b83d6bef4b05888faa9bfac',
                                    input: encodeFunctionData({
                                        abi: classicVaultFactoryAbi,
                                        functionName: 'booooost',
                                        args: [
                                            '0x0000000000000000000000000000000000000001',
                                            '0x0000000000000000000000000000000000000002',
                                            1n,
                                        ],
                                    }),
                                },
                                event: 'VaultOrStrategyCreated',
                                params: { proxy: '0x00000000000000000000000000000000deadbe01' },
                            },
                        ],
                    },
                },
            });

            expect(trace).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "addresses": {
                      "sets": [
                        {
                          "address": "0x00000000000000000000000000000000deadbe01",
                          "contract": "ClassicBoost",
                        },
                      ],
                    },
                    "block": 2189006,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should skip strategy when VaultOrStrategyCreated event detects a strategy', async () => {
            const indexer = createTestIndexer();

            // Tx pattern: https://basescan.org/tx/0x519bac361b822c2f8e1902cd3d1fdab34729075854f2c6e59458b3c9fbea75d1
            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicVaultFactory',
                                block: { number: 2189007, timestamp: 1715373000 },
                                logIndex: 0,
                                srcAddress: '0xbc4a342b0c057501e081484a2d24e576e854f823',
                                transaction: {
                                    hash: '0x519bac361b822c2f8e1902cd3d1fdab34729075854f2c6e59458b3c9fbea75d1',
                                    input: encodeFunctionData({
                                        abi: classicVaultFactoryAbi,
                                        functionName: 'cloneContract',
                                        args: ['0x0000000000000000000000000000000000000001'],
                                    }),
                                },
                                event: 'VaultOrStrategyCreated',
                                params: { proxy: '0x00000000000000000000000000000000deadbe02' },
                            },
                        ],
                    },
                },
            });

            expect(trace).toMatchInlineSnapshot(`
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

        it('Should skip blacklisted proxy addresses', async () => {
            const indexer = createTestIndexer();

            // Tx pattern: https://basescan.org/tx/0x8a9a3dde3386957af9763ce41a22a1dbd162b9c0e3711e4490e6c30c6d3f6b88
            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClassicVaultFactory',
                                block: { number: 13014756, timestamp: 1720000000 },
                                logIndex: 0,
                                srcAddress: '0xbc4a342b0c057501e081484a2d24e576e854f823',
                                transaction: {
                                    hash: '0x8a9a3dde3386957af9763ce41a22a1dbd162b9c0e3711e4490e6c30c6d3f6b88',
                                    input: encodeFunctionData({
                                        abi: classicVaultFactoryAbi,
                                        functionName: 'cloneVault',
                                        args: [],
                                    }),
                                },
                                event: 'VaultOrStrategyCreated',
                                params: { proxy: '0x0a1bbea11423f0cd2c247a9ad2ae6bd06aebc60d' },
                            },
                        ],
                    },
                },
            });

            expect(trace).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 13014756,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
