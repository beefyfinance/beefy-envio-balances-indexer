/**
 * Classic vault underlying breakdown integration tests (AAVE + CURVE).
 *
 * Requires live RPC: set `ENVIO_RPC_URL_137` (or the beefy dev RPC used by getViemClient).
 * Without network these tests produce empty traces — that is an environment failure, not a logic regression.
 */
import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';
import { AAVE_FIXTURE, CURVE_FIXTURE, initClassicPlatformSim } from './testFixtures/classicPlatforms';

const getClassicSet = (trace: Awaited<ReturnType<ReturnType<typeof createTestIndexer>['process']>>, vault: string) => {
    for (const change of trace.changes) {
        const sets = change.Classic?.sets;
        if (!sets) continue;
        const match = sets.find((row) => row.address?.toLowerCase() === vault.toLowerCase());
        if (match) return match;
    }
    throw new Error(`Classic entity not found for vault ${vault}`);
};

const breakdownSnapshot = (classic: ReturnType<typeof getClassicSet>) => ({
    address: classic.address,
    underlyingPlatform: classic.underlyingPlatform,
    underlyingBreakdownTokensOrder: classic.underlyingBreakdownTokensOrder,
    underlyingBreakdownToken_ids: classic.underlyingBreakdownToken_ids,
    vaultUnderlyingBreakdownBalances: classic.vaultUnderlyingBreakdownBalances,
});

describe('ClassicVault underlying breakdown', () => {
    describe('AAVE platform', () => {
        it('populates single-token breakdown after Initialized', async () => {
            const indexer = createTestIndexer();
            const trace = await indexer.process({
                chains: {
                    [AAVE_FIXTURE.chainId]: {
                        simulate: initClassicPlatformSim(AAVE_FIXTURE),
                    },
                },
            });

            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                breakdownSnapshot(getClassicSet(trace, AAVE_FIXTURE.vault)),
                'AAVE vault should have single-token underlying breakdown after Initialized'
            ).toMatchInlineSnapshot(`
              {
                "address": "0x009e0abc8cecbc576dfe2b8e372338b8e597dbc9",
                "underlyingBreakdownToken_ids": [
                  "137-0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4",
                ],
                "underlyingBreakdownTokensOrder": [
                  "0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4",
                ],
                "underlyingPlatform": "AAVE",
                "vaultUnderlyingBreakdownBalances": [
                  "47491.333264587624681985",
                ],
              }
            `);
        });
    });

    describe('CURVE platform', () => {
        it('populates multi-token breakdown after Initialized', async () => {
            const indexer = createTestIndexer();
            const trace = await indexer.process({
                chains: {
                    [CURVE_FIXTURE.chainId]: {
                        simulate: initClassicPlatformSim(CURVE_FIXTURE),
                    },
                },
            });

            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                breakdownSnapshot(getClassicSet(trace, CURVE_FIXTURE.vault)),
                'CURVE vault should have multi-token underlying breakdown after Initialized'
            ).toMatchInlineSnapshot(`
              {
                "address": "0x122e09fdd2ff73c8cea51d432c45a474baa1518a",
                "underlyingBreakdownToken_ids": [
                  "137-0x8343091f2499fd4b6174a46d067a920a3b851ff9",
                  "137-0x431d5dff03120afa4bdf332c61a6e1766ef37bdb",
                ],
                "underlyingBreakdownTokensOrder": [
                  "0x8343091f2499fd4b6174a46d067a920a3b851ff9",
                  "0x431d5dff03120afa4bdf332c61a6e1766ef37bdb",
                ],
                "underlyingPlatform": "CURVE",
                "vaultUnderlyingBreakdownBalances": [
                  "121702.383877155189262862",
                  "300458.357993762183373218",
                ],
              }
            `);
        });
    });
});
