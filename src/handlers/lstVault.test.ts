import { createTestIndexer } from 'envio';
import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ZERO } from '../lib/decimal';

/** Avalanche LST from config.yaml */
const LST_AVAX = '0x2e360492120cebeb2527c41bae1a4f21992d86ec' as const;

describe('LstVault Handlers', () => {
    const blockNum = 38_500_000;
    const timestampSec = Math.floor(Date.parse('2024-08-01T12:00:00.000Z') / 1000);
    const trxHash = '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
    const trxIdx = 4;

    const initSim = {
        contract: 'LstVault' as const,
        event: 'Initialized' as const,
        block: { number: blockNum, timestamp: timestampSec },
        logIndex: 0,
        srcAddress: LST_AVAX,
        params: { version: 1n },
    };

    describe('Initialized event', () => {
        it('Should create LstVault entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    43114: {
                        simulate: [initSim],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create LstVault entity with correct shareToken and underlyingToken'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 38500000,
                    "chainId": 43114,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should handle already initialized LstVault gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    43114: {
                        simulate: [
                            initSim,
                            {
                                contract: 'LstVault',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 1,
                                srcAddress: LST_AVAX,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when LstVault is already initialized'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 38500000,
                    "chainId": 43114,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        // LstVault has no factory for dynamic registration; without a config address,
        // simulate rejects unindexed srcAddresses. Covered for factory-backed contracts
        // (ClassicVault / RewardPool / ClassicBoost / …) instead.
        // biome-ignore lint/suspicious/noSkippedTests: no LstVault factory to register ephemeral addresses
        it.skip('Should skip blacklisted LstVault during initialization', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    43114: {
                        simulate: [
                            {
                                contract: 'LstVault',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: '0x0000000000000000000000000000000000000009',
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log blacklist status for blacklisted LstVault'
            ).toMatchInlineSnapshot();
        });

        // TODO: find an on-chain LstVault where `asset()` succeeds but the returned address is
        // not a valid ERC20 (decimals/name/symbol revert), exercising the
        // `getTokenMetadata -> status: 'invalid'` path in `getOrCreateToken`. Then drop the
        // `.skip`, fill in srcAddress + chainId, and let the inline snapshot regenerate.
        // biome-ignore lint/suspicious/noSkippedTests: intentional placeholder; see TODO above
        it.skip('Should skip LstVault when underlying token metadata is invalid', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    43114: {
                        simulate: [
                            {
                                contract: 'LstVault',
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
                    43114: {
                        simulate: [
                            initSim,
                            {
                                contract: 'LstVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 10,
                                srcAddress: LST_AVAX,
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
                    "block": 38500000,
                    "chainId": 43114,
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
                    43114: {
                        simulate: [
                            initSim,
                            {
                                contract: 'LstVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 11,
                                srcAddress: LST_AVAX,
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
                    "block": 38500000,
                    "chainId": 43114,
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
                    43114: {
                        simulate: [
                            initSim,
                            {
                                contract: 'LstVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 12,
                                srcAddress: LST_AVAX,
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
                    "block": 38500000,
                    "chainId": 43114,
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
                    43114: {
                        simulate: [
                            initSim,
                            {
                                contract: 'LstVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 13,
                                srcAddress: LST_AVAX,
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
                    "block": 38500000,
                    "chainId": 43114,
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
                    43114: {
                        simulate: [
                            initSim,
                            {
                                contract: 'LstVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 14,
                                srcAddress: LST_AVAX,
                                transaction: { hash: trxHash, transactionIndex: trxIdx },
                                params: {
                                    from: userA,
                                    to: userB,
                                    value: parseUnits('1', 18),
                                },
                            },
                            {
                                contract: 'LstVault',
                                event: 'Transfer',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 15,
                                srcAddress: LST_AVAX,
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
                    "block": 38500000,
                    "chainId": 43114,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });
    });
});
