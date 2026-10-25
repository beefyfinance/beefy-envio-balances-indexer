/**
 * CLM (docs/architecture.md "CLM"): ClmDeposit / ClmWithdraw raw amounts, ClmTvl, and
 * ClmPoolState read once per (strategy, block) even when Harvest and several TVL events share the block.
 * Expected pool state values are on-chain price() / range() / balancesOfPool() made outside the indexer.
 */
import { createTestIndexer } from 'envio';
import { afterAll, describe, expect, it } from 'vitest';
import { latestById, rowsOf } from '../helpers/simulate';
import { fakeHash, type Item, installRpcCounter } from './harness';
import { CHAIN, CLM, CLM_MANAGER_FACTORY, CLM_STRATEGY_FACTORY, DEPLOYER, ZAP } from './realData';

type Row = Record<string, unknown> & { id: string };

const KEEPER = '0xa4c63a2e8d0556ddb36c6544625284c663642387';
const TX_25191220 = '0xeb3e872f7fe754b8896dea4275e5f59aa86ac03f5b30aad6e72a7f352923edeb';
const TX_25114618 = '0x8b17933280c9ec3ae0e722847770b3ae422a5043bacc8d98e2cc7bd1cb534f92';

const setup = (): Item[] => [
    {
        contract: 'ClmManagerFactory',
        event: 'ClmManagerCreated',
        srcAddress: CLM_MANAGER_FACTORY,
        logIndex: CLM.managerCreation.logIndex,
        block: { number: CLM.managerCreation.block, timestamp: 1737017055 },
        transaction: { hash: CLM.managerCreation.hash, from: DEPLOYER },
        params: { proxy: CLM.manager },
    },
    {
        contract: 'ClmStrategyFactory',
        event: 'ClmStrategyCreatedWithName',
        srcAddress: CLM_STRATEGY_FACTORY,
        logIndex: CLM.strategyCreation.logIndex,
        block: { number: CLM.strategyCreation.block, timestamp: 1737017061 },
        transaction: { hash: CLM.strategyCreation.hash, from: DEPLOYER },
        params: { proxy: CLM.strategy, strategyName: 'StrategyPassiveManagerUniswap' },
    },
];

/** Real block 25114618: TVL (log 269) then the first Deposit (log 272). */
const block25114618 = (): Item[] => [
    {
        contract: 'ClmStrategy',
        event: 'TVL',
        srcAddress: CLM.strategy,
        logIndex: 269,
        block: { number: 25114618, timestamp: 1737018583 },
        transaction: { hash: TX_25114618, from: '0x982f264ce97365864181df65df4931c593a515ad' },
        params: { bal0: 499999999999998n, bal1: 9704460471748505696n },
    },
    {
        contract: 'ClmManager',
        event: 'Deposit',
        srcAddress: CLM.manager,
        logIndex: 272,
        block: { number: 25114618, timestamp: 1737018583 },
        transaction: { hash: TX_25114618, from: '0x982f264ce97365864181df65df4931c593a515ad' },
        params: {
            user: ZAP,
            shares: 19446522339848338447n,
            amount0: 500000000000000n,
            amount1: 9704460471748505697n,
            fee0: 0n,
            fee1: 0n,
        },
    },
];

/** Real block 25191220: two TVL events and two Deposits in one tx, plus a simulated Harvest(fee0, fee1). */
const block25191220 = (): Item[] => [
    {
        contract: 'ClmStrategy',
        event: 'Harvest',
        srcAddress: CLM.strategy,
        logIndex: 500,
        block: { number: 25191220, timestamp: 1737171787 },
        transaction: { hash: TX_25191220, from: KEEPER },
        params: { fee0: 11n, fee1: 22n },
    },
    {
        contract: 'ClmStrategy',
        event: 'TVL',
        srcAddress: CLM.strategy,
        logIndex: 513,
        block: { number: 25191220, timestamp: 1737171787 },
        transaction: { hash: TX_25191220, from: KEEPER },
        params: { bal0: 176512843779078631n, bal1: 3280448000520169968661n },
    },
    {
        contract: 'ClmManager',
        event: 'Deposit',
        srcAddress: CLM.manager,
        logIndex: 515,
        block: { number: 25191220, timestamp: 1737171787 },
        transaction: { hash: TX_25191220, from: KEEPER },
        params: {
            user: ZAP,
            shares: 6709092173001721174392n,
            amount0: 175903992626798062n,
            amount1: 3272816006368248872545n,
            fee0: 0n,
            fee1: 14733421993156240n,
        },
    },
    {
        contract: 'ClmStrategy',
        event: 'TVL',
        srcAddress: CLM.strategy,
        logIndex: 572,
        block: { number: 25191220, timestamp: 1737171787 },
        transaction: { hash: TX_25191220, from: KEEPER },
        params: { bal0: 176513964521236372n, bal1: 3280468828777058369687n },
    },
];

describe('CLM (real Base manager 0x8145 / strategy 0x1d2b)', () => {
    const counter = installRpcCounter();
    afterAll(() => counter.restore());

    it('ClmDeposit: raw shares / amounts / fees exactly as in the event, with event columns', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({ chains: { [CHAIN]: { simulate: [...setup(), ...block25114618()] } } });
        const deposits = rowsOf<Row>(result, 'ClmDeposit');
        expect(deposits).toHaveLength(1);
        expect(deposits[0]).toEqual({
            id: `${CHAIN}-${TX_25114618}-272`,
            manager: CLM.manager,
            user: ZAP,
            shares: 19446522339848338447n,
            amount0: 500000000000000n,
            amount1: 9704460471748505697n,
            fee0: 0n,
            fee1: 0n,
            blockNumber: 25114618n,
            blockTimestamp: new Date(1737018583 * 1000),
            trxHash: TX_25114618,
            trxFrom: '0x982f264ce97365864181df65df4931c593a515ad',
            logIndex: 272,
        });
    });

    it('ClmWithdraw: raw shares / amounts', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        ...setup(),
                        {
                            contract: 'ClmManager',
                            event: 'Withdraw',
                            srcAddress: CLM.manager,
                            logIndex: 4,
                            block: { number: 25200000, timestamp: 1737189347 },
                            transaction: { hash: fakeHash(700), from: KEEPER },
                            params: { user: ZAP, shares: 123n, amount0: 456n, amount1: 789n },
                        },
                    ],
                },
            },
        });
        expect(rowsOf(result, 'ClmWithdraw')).toEqual([
            {
                id: `${CHAIN}-${fakeHash(700)}-4`,
                manager: CLM.manager,
                user: ZAP,
                shares: 123n,
                amount0: 456n,
                amount1: 789n,
                blockNumber: 25200000n,
                blockTimestamp: new Date(1737189347 * 1000),
                trxHash: fakeHash(700),
                trxFrom: KEEPER,
                logIndex: 4,
            },
        ]);
    });

    it('ClmTvl rows and one ClmPoolState per (strategy, block) with on-chain values; one eth_call for the block', async () => {
        const indexer = createTestIndexer();
        counter.reset();
        const result = await indexer.process({
            chains: { [CHAIN]: { simulate: [...setup(), ...block25114618(), ...block25191220()] } },
        });
        // reads pinned to block 25191220 (0x1806334): only the pool-state multicall
        const rpcForBlock = counter.described().filter((r) => r.block === '0x1806334').length;

        const tvl = rowsOf<Row>(result, 'ClmTvl').filter((r) => r.blockNumber === 25191220n);
        expect(tvl.map((r) => [r.logIndex, r.bal0, r.bal1, r.strategy])).toEqual([
            [513, 176512843779078631n, 3280448000520169968661n, CLM.strategy],
            [572, 176513964521236372n, 3280468828777058369687n, CLM.strategy],
        ]);

        const states = latestById<Row>(result, 'ClmPoolState');
        expect([...states.keys()].sort()).toEqual([
            `${CHAIN}-${CLM.strategy}-25114618`,
            `${CHAIN}-${CLM.strategy}-25191220`,
        ]);
        const poolStateSets = rowsOf<Row>(result, 'ClmPoolState').filter((r) => r.blockNumber === 25191220n);
        expect(poolStateSets.length).toBeGreaterThanOrEqual(1);
        expect(states.get(`${CHAIN}-${CLM.strategy}-25191220`)).toMatchObject({
            strategy: CLM.strategy,
            status: 'OK',
            price: 18584755249675362502074370648332457482496n,
            rangeLower: 15359938950714761652553039052585720314944n,
            rangeUpper: 22913878029345184251703936401904716675801n,
            token0Bal: 176513964521236371n,
            token1Bal: 2999447289826207078015n,
            mainAmount0: 176513964521236371n,
            mainAmount1: 2999447289826207078015n,
            altAmount0: 0n,
            altAmount1: 0n,
            blockNumber: 25191220n,
            blockTimestamp: new Date(1737171787 * 1000),
        });
        // Harvest + 2 TVL in the block share one cached multicall, facts were read before
        expect(rpcForBlock).toBe(1);

        const harvest = rowsOf<Row>(result, 'Harvest').filter((r) => r.kind === 'CLM_HARVEST');
        expect(harvest).toHaveLength(1);
        expect(harvest[0]).toMatchObject({ kind: 'CLM_HARVEST', fee0: 11n, fee1: 22n, strategy: CLM.strategy });
    });

    it('ClmPoolState at the first TVL block matches on-chain state (price, range, balancesOfPool order)', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({ chains: { [CHAIN]: { simulate: [...setup(), ...block25114618()] } } });
        expect(latestById<Row>(result, 'ClmPoolState').get(`${CHAIN}-${CLM.strategy}-25114618`)).toMatchObject({
            status: 'OK',
            price: 19484123736199667500235434151493922410436n,
            rangeLower: 15670214631070498901269182418053546227641n,
            rangeUpper: 23376745695548546138166474038292081574969n,
            token0Bal: 499999999999997n,
            token1Bal: 9704460471748500783n,
            mainAmount0: 420123674117654n,
            mainAmount1: 9704460471748500783n,
            altAmount0: 79876325882343n,
            altAmount1: 0n,
        });
    });

    it('CLM manager shares: Transfer handled as share token (Balance on the manager token)', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        ...setup(),
                        {
                            contract: 'ClmManager',
                            event: 'Transfer',
                            srcAddress: CLM.manager,
                            logIndex: 271,
                            block: { number: 25114618, timestamp: 1737018583 },
                            transaction: { hash: TX_25114618, from: DEPLOYER },
                            params: {
                                from: '0x0000000000000000000000000000000000000000',
                                to: CLM.clmVault,
                                value: 19446522339848338447n,
                            },
                        },
                    ],
                },
            },
        });
        expect(latestById<Row>(result, 'Balance').get(`${CHAIN}-${CLM.manager}-${CLM.clmVault}`)).toMatchObject({
            balance: 19446522339848338447n,
        });
    });
});
