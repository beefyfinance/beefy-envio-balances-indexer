import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';
import { latestById, rowsOf, tx } from '../../test/helpers/simulate';
import { FACTS_RETRY_BLOCKS } from '../lib/registry';

// Base swapper listed in config.yaml
const SWAPPER = '0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc' as const;
const WETH = '0x4200000000000000000000000000000000000006' as const;
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as const;
const ROUTER = '0xba12222222228d8ba445958a75a0704d566bf2c8' as const;
const ORACLE = '0xdd27227dba7ea8f5869466a10a8e36bb2d709b35' as const;
const at = (offset: number) => ({ number: 20_000_000 + offset, timestamp: 1_725_000_000 + offset * 2 });

const setSwapInfo = (logIndex: number, offset: number, data: `0x${string}`, amountIndex: bigint) => ({
    contract: 'BeefySwapper' as const,
    event: 'SetSwapInfo' as const,
    srcAddress: SWAPPER,
    logIndex,
    block: at(offset),
    transaction: tx(logIndex + offset * 10),
    params: {
        fromToken: WETH,
        toToken: USDC,
        swapInfo: { router: ROUTER, data, amountIndex, minIndex: 4n, minAmountSign: -1n },
    },
});

describe('BeefySwapper', () => {
    it('keeps the current route and its change history', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: { 8453: { simulate: [setSwapInfo(1, 0, '0xabcd', 36n), setSwapInfo(1, 1, '0xef01', 68n)] } },
        });

        expect(rowsOf(result, 'SwapperRouteChange')).toEqual([
            expect.objectContaining({
                swapper: SWAPPER,
                fromToken: WETH,
                toToken: USDC,
                data: '0xabcd',
                amountIndex: 36n,
            }),
            expect.objectContaining({
                data: '0xef01',
                amountIndex: 68n,
                minIndex: 4n,
                minAmountSign: -1,
                router: ROUTER,
            }),
        ]);
        expect(latestById(result, 'SwapperRoute').get(`8453-${SWAPPER}-${WETH}-${USDC}`)).toEqual({
            id: `8453-${SWAPPER}-${WETH}-${USDC}`,
            swapper: SWAPPER,
            fromToken: WETH,
            toToken: USDC,
            router: ROUTER,
            data: '0xef01',
            amountIndex: 68n,
            minIndex: 4n,
            minAmountSign: -1,
            updatedBlock: BigInt(at(1).number),
            updatedTimestamp: new Date(at(1).timestamp * 1000),
            updatedTrxHash: tx(11).hash,
        });
        expect(rowsOf<{ symbol: string }>(result, 'Token').map(({ symbol }) => symbol)).toEqual(['WETH', 'USDC']);
        expect(rowsOf(result, 'Contract')).toEqual([expect.objectContaining({ kind: 'SWAPPER', factsStatus: 'OK' })]);
    });

    it('records configuration changes from events only', async () => {
        const indexer = createTestIndexer();
        const event = { srcAddress: SWAPPER, block: at(0), transaction: tx(1) };
        const result = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        {
                            ...event,
                            contract: 'BeefySwapper',
                            event: 'Initialized',
                            logIndex: 1,
                            params: { version: 1n },
                        },
                        {
                            ...event,
                            contract: 'BeefySwapper',
                            event: 'SetOracle',
                            logIndex: 2,
                            params: { oracle: ORACLE },
                        },
                        {
                            ...event,
                            contract: 'BeefySwapper',
                            event: 'SetSlippage',
                            logIndex: 3,
                            params: { slippage: 99n },
                        },
                    ],
                },
            },
        });
        expect(
            rowsOf(result, 'SwapperConfigChange').map(({ kind, oracle, slippage, version }) => ({
                kind,
                oracle,
                slippage,
                version,
            }))
        ).toEqual([
            { kind: 'INITIALIZED', oracle: undefined, slippage: undefined, version: 1 },
            { kind: 'SET_ORACLE', oracle: ORACLE, slippage: undefined, version: undefined },
            { kind: 'SET_SLIPPAGE', oracle: undefined, slippage: 99n, version: undefined },
        ]);
    });
});

describe('LST vault', () => {
    // beJOE on Avalanche, listed in config.yaml
    const LST = '0x2e360492120cebeb2527c41bae1a4f21992d86ec' as const;

    it('writes share transfers and reads asset() once', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                43114: {
                    simulate: [
                        {
                            contract: 'LstVault',
                            event: 'Transfer',
                            srcAddress: LST,
                            logIndex: 1,
                            block: { number: 38_500_000, timestamp: 1_722_513_600 },
                            transaction: tx(1),
                            params: {
                                from: '0x0000000000000000000000000000000000000000',
                                to: '0x94b32bdb9ff47f3239f04514bce862c7d95600ca',
                                value: 3n,
                            },
                        },
                    ],
                },
            },
        });
        expect(rowsOf(result, 'ShareTransfer')).toHaveLength(1);
        expect(rowsOf(result, 'Contract')).toMatchInlineSnapshot(`
          [
            {
              "address": "0x2e360492120cebeb2527c41bae1a4f21992d86ec",
              "createdBlock": undefined,
              "createdTimestamp": undefined,
              "createdTrxHash": undefined,
              "deployName": undefined,
              "factory": undefined,
              "factsBlock": 38500000n,
              "factsStatus": "PARTIAL",
              "id": "43114-0x2e360492120cebeb2527c41bae1a4f21992d86ec",
              "kind": "LST_VAULT",
            },
          ]
        `);
        expect(rowsOf(result, 'ContractLink')).toMatchInlineSnapshot(`[]`);
    });

    it('retries an incomplete fact read at most once per FACTS_RETRY_BLOCKS', async () => {
        const transfer = (logIndex: number, number: number) => ({
            contract: 'LstVault' as const,
            event: 'Transfer' as const,
            srcAddress: LST,
            logIndex,
            block: { number, timestamp: 1_722_513_600 + (number - 38_500_000) * 2 },
            transaction: tx(logIndex),
            params: {
                from: '0x0000000000000000000000000000000000000000' as const,
                to: '0x94b32bdb9ff47f3239f04514bce862c7d95600ca' as const,
                value: 1n,
            },
        });
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                43114: {
                    simulate: [
                        transfer(1, 38_500_000),
                        transfer(2, 38_500_005), // too early: no retry
                        transfer(3, 38_500_000 + Number(FACTS_RETRY_BLOCKS)), // retried
                    ],
                },
            },
        });
        expect(rowsOf<{ factsBlock: bigint }>(result, 'Contract').map(({ factsBlock }) => factsBlock)).toEqual([
            38_500_000n,
            38_500_000n + FACTS_RETRY_BLOCKS,
        ]);
    });
});
