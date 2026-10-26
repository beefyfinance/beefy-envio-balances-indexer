import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

import { latestById, rowsOf, tx, USER_A, ZERO } from '../../test/helpers/simulate';

// Cow Sushi Base WETH-USDC
const MANAGER_FACTORY = '0x7bc78990ac1ef0754cfde935b2d84e9acf13ed29' as const;
const STRATEGY_FACTORY = '0x9476284d81121613da5df5c72f50853a455448f1' as const;
const MANAGER = '0x603492ff8943f5ac69aa69cf09fc96fda2606ee7' as const;
const STRATEGY = '0x51582dcef28aea484dd87933324a55482882ce17' as const;
const INIT = { number: 15_683_455, timestamp: Math.floor(Date.parse('2024-07-15T12:00:00.000Z') / 1000) };
// https://basescan.org/tx/0x7e29db7de6b8d447c99f929ab6d2fdb8acf913f66d011e4885293bb0977663d2 (Harvest + TVL)
const HARVEST = { number: 17_487_152, timestamp: 1_721_763_651 };

const register = [
    {
        contract: 'ClmManagerFactory' as const,
        event: 'ClmManagerCreated' as const,
        srcAddress: MANAGER_FACTORY,
        logIndex: 1,
        block: INIT,
        transaction: tx(1),
        params: { proxy: MANAGER },
    },
    {
        contract: 'ClmStrategyFactory' as const,
        event: 'ClmStrategyCreatedWithName' as const,
        srcAddress: STRATEGY_FACTORY,
        logIndex: 2,
        block: INIT,
        transaction: tx(1),
        params: { strategyName: 'StrategyPassiveManagerUniswap', proxy: STRATEGY },
    },
];

describe('CLM manager', () => {
    it('writes deposits, withdrawals and share transfers', async () => {
        const indexer = createTestIndexer();
        const block = { number: 17_452_460, timestamp: 1_721_694_267 };
        const result = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        ...register,
                        {
                            contract: 'ClmManager',
                            event: 'Transfer',
                            srcAddress: MANAGER,
                            logIndex: 1,
                            block,
                            transaction: tx(2, USER_A),
                            params: { from: ZERO, to: USER_A, value: 1_000n },
                        },
                        {
                            contract: 'ClmManager',
                            event: 'Deposit',
                            srcAddress: MANAGER,
                            logIndex: 2,
                            block,
                            transaction: tx(2, USER_A),
                            params: { user: USER_A, shares: 1_000n, amount0: 11n, amount1: 22n, fee0: 1n, fee1: 2n },
                        },
                        {
                            contract: 'ClmManager',
                            event: 'Withdraw',
                            srcAddress: MANAGER,
                            logIndex: 1,
                            block: { number: block.number + 1, timestamp: block.timestamp + 2 },
                            transaction: tx(3, USER_A),
                            params: { user: USER_A, shares: 400n, amount0: 4n, amount1: 9n },
                        },
                    ],
                },
            },
        });

        expect(rowsOf(result, 'ClmDeposit')).toEqual([
            {
                id: `8453-${tx(2).hash}-2`,
                manager: MANAGER,
                user: USER_A,
                shares: 1_000n,
                amount0: 11n,
                amount1: 22n,
                fee0: 1n,
                fee1: 2n,
                blockNumber: BigInt(block.number),
                blockTimestamp: new Date(block.timestamp * 1000),
                trxHash: tx(2).hash,
                trxFrom: USER_A,
                logIndex: 2,
            },
        ]);
        expect(rowsOf(result, 'ClmWithdraw')).toEqual([
            expect.objectContaining({ manager: MANAGER, user: USER_A, shares: 400n, amount0: 4n, amount1: 9n }),
        ]);
        expect(rowsOf(result, 'ShareTransfer')).toEqual([expect.objectContaining({ totalSupplyAfter: 1_000n })]);
        expect(latestById(result, 'Contract').get(`8453-${MANAGER}`)).toMatchObject({
            kind: 'CLM_MANAGER',
            factory: MANAGER_FACTORY,
            createdBlock: BigInt(INIT.number),
            // facts are read at latest as soon as the factory event registers the contract
            factsBlock: BigInt(INIT.number),
        });
        expect(
            rowsOf<{ relation: string; toAddress: string }>(result, 'ContractLink').map(({ relation, toAddress }) => [
                relation,
                toAddress,
            ])
        ).toMatchInlineSnapshot(`
          [
            [
              "CLM_WANT0",
              "0x4200000000000000000000000000000000000006",
            ],
            [
              "CLM_WANT1",
              "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            ],
            [
              "CLM_STRATEGY_MANAGER",
              "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
            ],
            [
              "CLM_POOL",
              "0x57713f7716e0b0f65ec116912f834e49805480d2",
            ],
          ]
        `);
    });
});

describe('CLM strategy', () => {
    it('reads pool state once per block for a harvest and its TVL event', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        ...register,
                        {
                            contract: 'ClmStrategy',
                            event: 'Harvest',
                            srcAddress: STRATEGY,
                            logIndex: 10,
                            block: HARVEST,
                            transaction: tx(4),
                            params: { fee0: 5n, fee1: 6n },
                        },
                        {
                            contract: 'ClmStrategy',
                            event: 'ChargedFeesV2',
                            srcAddress: STRATEGY,
                            logIndex: 11,
                            block: HARVEST,
                            transaction: tx(4),
                            params: { callFeeAmount: 1n, beefyFeeAmount: 2n, strategistFeeAmount: 3n },
                        },
                        {
                            contract: 'ClmStrategy',
                            event: 'TVL',
                            srcAddress: STRATEGY,
                            logIndex: 12,
                            block: HARVEST,
                            transaction: tx(4),
                            params: { bal0: 100n, bal1: 200n },
                        },
                        {
                            contract: 'ClmStrategy',
                            event: 'ClaimedFees',
                            srcAddress: STRATEGY,
                            logIndex: 13,
                            block: HARVEST,
                            transaction: tx(4),
                            params: { feeMain0: 1n, feeMain1: 2n, feeAlt0: 3n, feeAlt1: 4n },
                        },
                        {
                            contract: 'ClmStrategy',
                            event: 'Unpaused',
                            srcAddress: STRATEGY,
                            logIndex: 14,
                            block: HARVEST,
                            transaction: tx(4),
                            params: { account: USER_A },
                        },
                    ],
                },
            },
        });

        expect(
            rowsOf(result, 'Harvest').map(({ kind, fee0, fee1, feeMain0, feeAlt1 }) => ({
                kind,
                fee0,
                fee1,
                feeMain0,
                feeAlt1,
            }))
        ).toEqual([
            { kind: 'CLM_HARVEST', fee0: 5n, fee1: 6n, feeMain0: undefined, feeAlt1: undefined },
            { kind: 'CLM_CLAIMED_FEES', fee0: undefined, fee1: undefined, feeMain0: 1n, feeAlt1: 4n },
        ]);
        expect(rowsOf(result, 'FeesCharged')).toEqual([
            expect.objectContaining({ family: 'CLM', version: 2, callFee: 1n, beefyFee: 2n, strategistFee: 3n }),
        ]);
        expect(rowsOf(result, 'ClmTvl')).toEqual([
            expect.objectContaining({ strategy: STRATEGY, bal0: 100n, bal1: 200n, logIndex: 12 }),
        ]);
        expect(rowsOf(result, 'PauseChange')).toEqual([expect.objectContaining({ contract: STRATEGY, paused: false })]);
        // Harvest and TVL share the (strategy, block) read: one row id, identical values
        const states = rowsOf(result, 'ClmPoolState');
        expect(new Set(states.map((state) => state.id))).toEqual(new Set([`8453-${STRATEGY}-${HARVEST.number}`]));
        expect(states[0]).toMatchInlineSnapshot(`
          {
            "altAmount0": 0n,
            "altAmount1": 0n,
            "blockNumber": 17487152n,
            "blockTimestamp": 2024-07-23T19:40:51.000Z,
            "id": "8453-0x51582dcef28aea484dd87933324a55482882ce17-17487152",
            "mainAmount0": 207238217227238923n,
            "mainAmount1": 1197903770n,
            "price": 3476243747648730851239297321n,
            "rangeLower": 3184336896959434787787545289n,
            "rangeUpper": 3662833661090655655420012681n,
            "status": "OK",
            "strategy": "0x51582dcef28aea484dd87933324a55482882ce17",
            "token0Bal": 207238217227238923n,
            "token1Bal": 1197903770n,
          }
        `);
        expect(
            rowsOf<{ relation: string; toAddress: string }>(result, 'ContractLink').map(({ relation, toAddress }) => [
                relation,
                toAddress,
            ])
        ).toMatchInlineSnapshot(`
          [
            [
              "CLM_WANT0",
              "0x4200000000000000000000000000000000000006",
            ],
            [
              "CLM_WANT1",
              "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            ],
            [
              "CLM_STRATEGY_MANAGER",
              "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
            ],
            [
              "CLM_POOL",
              "0x57713f7716e0b0f65ec116912f834e49805480d2",
            ],
          ]
        `);
        expect(latestById(result, 'Contract').get(`8453-${STRATEGY}`)).toMatchObject({
            kind: 'CLM_STRATEGY',
            deployName: 'StrategyPassiveManagerUniswap',
        });
    });

    it('stores a failed pool state read when the strategy calls revert', async () => {
        const NOT_A_STRATEGY = '0x00000000000000000000000000000000000c1a55' as const;
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        {
                            contract: 'ClmStrategyFactory',
                            event: 'ClmStrategyCreated',
                            srcAddress: STRATEGY_FACTORY,
                            logIndex: 1,
                            block: HARVEST,
                            transaction: tx(1),
                            params: { proxy: NOT_A_STRATEGY },
                        },
                        {
                            contract: 'ClmStrategy',
                            event: 'TVL',
                            srcAddress: NOT_A_STRATEGY,
                            logIndex: 2,
                            block: HARVEST,
                            transaction: tx(1),
                            params: { bal0: 1n, bal1: 2n },
                        },
                    ],
                },
            },
        });
        expect(rowsOf(result, 'ClmPoolState')).toEqual([
            {
                id: `8453-${NOT_A_STRATEGY}-${HARVEST.number}`,
                strategy: NOT_A_STRATEGY,
                status: 'FAILED',
                price: undefined,
                rangeLower: undefined,
                rangeUpper: undefined,
                token0Bal: undefined,
                token1Bal: undefined,
                mainAmount0: undefined,
                mainAmount1: undefined,
                altAmount0: undefined,
                altAmount1: undefined,
                blockNumber: BigInt(HARVEST.number),
                blockTimestamp: new Date(HARVEST.timestamp * 1000),
            },
        ]);
        expect(latestById(result, 'Contract').get(`8453-${NOT_A_STRATEGY}`)).toMatchObject({ factsStatus: 'PARTIAL' });
    });
});
