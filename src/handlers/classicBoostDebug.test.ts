import { createTestIndexer } from 'envio';
import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';

describe('ClassicBoost Handlers', () => {
    describe('Staking event: Should update balances when Staking event is emitted', () => {
        const setupEvents = [
            {
                contract: 'ClassicBoost',
                event: 'Initialized',
                block: { number: 2578061, timestamp: 1691945469 },
                logIndex: 4,
                srcAddress: '0x01e8881ed2fb41e0b3df29f382faf707a0b26969',
                params: { version: 1n },
            },
        ] as const;

        const testEvents = [
            {
                contract: 'ClassicBoost',
                event: 'Staked',
                block: { number: 2578062, timestamp: 1691945470 },
                logIndex: 31,
                srcAddress: '0x01e8881ed2fb41e0b3df29f382faf707a0b26969',
                transaction: {
                    hash: '0xdf0648408ce8b090539f2d7c809aae57f87ce7f1a5f14c1f21ced3c9f6f27cc2',
                    transactionIndex: 7,
                },
                params: { user: '0xc29d2531651fcd304c60fbfb8073a518d8fe0a21', amount: parseUnits('1', 18) },
            },
        ] as const;

        it('Single `.process()` call, all is well', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: { 8453: { simulate: [...setupEvents, ...testEvents] } },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace).toMatchInlineSnapshot();
        });

        it('Split `.process()` calls, never finishes', async () => {
            const indexer = createTestIndexer();

            await indexer.process({
                chains: { 8453: { simulate: [...setupEvents] } },
            });
            const trace = await indexer.process({
                chains: { 8453: { simulate: [...testEvents] } },
            });
            expect(trace).toMatchInlineSnapshot();
        });
    });
});
