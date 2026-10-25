/**
 * Raw event rows (docs/architecture.md "Rewards", "Strategy activity", "Swapper"): every column equals the event
 * param (no decimals, no prices) and every row carries chainId, blockNumber, blockTimestamp, trxHash, trxFrom,
 * logIndex from the event. Real Base logs where available, decoded outside the indexer.
 */
import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';
import { latestById, rowsOf } from '../helpers/simulate';
import { fakeHash, strategyCreated } from './harness';
import { CHAIN, CLM, CLM_STRATEGY_FACTORY, DEPLOYER, REWARD_POOL_FACTORY, STRATEGY, SWAPPER } from './realData';

type Row = Record<string, unknown> & { id: string };

const S = STRATEGY.address;
const CLM_KEEPER = '0x982f264ce97365864181df65df4931c593a515ad';
const AERO = '0x940181a94a35a4569e4529a3cdfb74e38fd98631';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WETH = '0x4200000000000000000000000000000000000006';
const SWAPPER_OWNER = '0x4fed5491693007f0cd49f4614ffc38ab6a04b619';

type Ev = { block: number; timestamp: number; hash: `0x${string}`; from: `0x${string}`; logIndex: number };

const columns = (e: Ev) => ({
    id: `${CHAIN}-${e.hash}-${e.logIndex}`,
    blockNumber: BigInt(e.block),
    blockTimestamp: new Date(e.timestamp * 1000),
    trxHash: e.hash,
    trxFrom: e.from,
    logIndex: e.logIndex,
});

const sim = (contract: string, event: string, src: string, e: Ev, params: Record<string, unknown>) => ({
    contract,
    event,
    srcAddress: src,
    logIndex: e.logIndex,
    block: { number: e.block, timestamp: e.timestamp },
    transaction: { hash: e.hash, from: e.from },
    params,
});

// real classic strategy S logs
const S_FEES: Ev = {
    block: 25059245,
    timestamp: 1736907837,
    hash: '0x42988abe83da4d1c463fa65f749a73c7fbb6c396652680452770a1f12b4eabff',
    from: DEPLOYER,
    logIndex: 169,
};
const S_HARVEST: Ev = { ...S_FEES, logIndex: 196 };
const S_PAUSED: Ev = {
    block: 25059257,
    timestamp: 1736907861,
    hash: '0xab253171084b3e2dbbdf7cb94d9b7754b8eac26ce8dfbc94fe8ab65c069febb8',
    from: DEPLOYER,
    logIndex: 354,
};
const S_UNPAUSED: Ev = {
    block: 25059289,
    timestamp: 1736907925,
    hash: '0x8071eb0c13e722cf3dc8df5e7c683f196ab60213c01f9016987dd5c154b07a94',
    from: DEPLOYER,
    logIndex: 568,
};

describe('classic strategy rows (real strategy 0x3543)', () => {
    it('ChargedFeesV2, StratHarvest, Paused, Unpaused: raw params + event columns + chainId', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        strategyCreated(),
                        sim('ClassicStrategy', 'ChargedFeesV2', S, S_FEES, {
                            callFees: 0x25c4f8n,
                            beefyFees: 0x84a2b5b8n,
                            strategistFees: 0x07607898n,
                        }),
                        sim('ClassicStrategyStratHarvest0', 'StratHarvest', S, S_HARVEST, {
                            harvester: DEPLOYER,
                            wantHarvested: 0x15177d91c10n,
                            tvl: 0xe64b0f94da028bn,
                        }),
                        sim('ClassicStrategy', 'Paused', S, S_PAUSED, { account: DEPLOYER }),
                        sim('ClassicStrategy', 'Unpaused', S, S_UNPAUSED, { account: DEPLOYER }),
                    ] as never,
                },
            },
        });
        expect(rowsOf(result, 'FeesCharged')).toEqual([
            {
                ...columns(S_FEES),
                strategy: S,
                family: 'CLASSIC',
                version: 2,
                callFee: 2475256n,
                beefyFee: 2225255864n,
                strategistFee: 123762840n,
                liquidityFee: undefined,
            },
        ]);
        expect(rowsOf(result, 'Harvest')).toEqual([
            {
                ...columns(S_HARVEST),
                strategy: S,
                kind: 'CLASSIC_STRAT_HARVEST',
                harvester: DEPLOYER,
                wantHarvested: 1449414695952n,
                tvl: 64821774937358987n,
                fee0: undefined,
                fee1: undefined,
                fees: undefined,
                feeMain0: undefined,
                feeMain1: undefined,
                feeAlt0: undefined,
                feeAlt1: undefined,
            },
        ]);
        expect(rowsOf(result, 'PauseChange')).toEqual([
            { ...columns(S_PAUSED), contract: S, paused: true, account: DEPLOYER },
            { ...columns(S_UNPAUSED), contract: S, paused: false, account: DEPLOYER },
        ]);
        // chainId is populated on every stored event row
        for (const entity of ['FeesCharged', 'Harvest', 'PauseChange'] as const) {
            const stored = await (indexer[entity] as unknown as { getWhere: (f: unknown) => Promise<Row[]> }).getWhere({
                chainId: { _eq: CHAIN },
            });
            expect(stored.length, entity).toBeGreaterThan(0);
            for (const row of stored) expect(row.chainId, entity).toBe(CHAIN);
        }
    });

    it('ChargedFees v1 (beefyFee, liquidityFee)', async () => {
        const e: Ev = { block: 25060000, timestamp: 1736909363, hash: fakeHash(801), from: DEPLOYER, logIndex: 5 };
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        strategyCreated(),
                        sim('ClassicStrategy', 'ChargedFees', S, e, { beefyFee: 7n, liquidityFee: 9n }),
                    ] as never,
                },
            },
        });
        expect(rowsOf(result, 'FeesCharged')).toEqual([
            {
                ...columns(e),
                strategy: S,
                family: 'CLASSIC',
                version: 1,
                callFee: undefined,
                beefyFee: 7n,
                strategistFee: undefined,
                liquidityFee: 9n,
            },
        ]);
    });
});

// real CLM strategy 0x1d2b logs
const C_CLAIMED: Ev = {
    block: 25115953,
    timestamp: 1737021253,
    hash: '0xd24407202be4bfaec096f8caa1e471c91cbf09b7e96a0fe9a261cf06d01baae5',
    from: CLM_KEEPER,
    logIndex: 367,
};
const C_FEES: Ev = { ...C_CLAIMED, logIndex: 380 };
const C_HARVEST_REWARDS: Ev = { ...C_CLAIMED, logIndex: 384 };
const C_PAUSED: Ev = {
    block: 25115962,
    timestamp: 1737021271,
    hash: '0x3bef244f790c56f20dc659df83f6f635500539d96486450f5f39cf6b370ed805',
    from: CLM_KEEPER,
    logIndex: 474,
};
const C_CLAIMED_FEES: Ev = {
    block: 25116000,
    timestamp: 1737021347,
    hash: fakeHash(802),
    from: CLM_KEEPER,
    logIndex: 1,
};

const clmStrategyCreated = () => ({
    contract: 'ClmStrategyFactory',
    event: 'ClmStrategyCreatedWithName',
    srcAddress: CLM_STRATEGY_FACTORY,
    logIndex: CLM.strategyCreation.logIndex,
    block: { number: CLM.strategyCreation.block, timestamp: 1737017061 },
    transaction: { hash: CLM.strategyCreation.hash, from: DEPLOYER },
    params: { proxy: CLM.strategy, strategyName: 'StrategyPassiveManagerUniswap' },
});

describe('CLM strategy rows (real strategy 0x1d2b)', () => {
    it('ClaimedRewards, ChargedFeesV2, HarvestRewards, ClaimedFees, Paused: raw params', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        clmStrategyCreated(),
                        sim('ClmStrategy', 'ClaimedRewards', CLM.strategy, C_CLAIMED, { fees: 632696335367026n }),
                        sim('ClmStrategy', 'ChargedFeesV2', CLM.strategy, C_FEES, {
                            callFeeAmount: 23510111n,
                            beefyFeeAmount: 21135590447n,
                            strategistFeeAmount: 1175505586n,
                        }),
                        sim('ClmStrategy', 'HarvestRewards', CLM.strategy, C_HARVEST_REWARDS, {
                            fees: 572590183507159n,
                        }),
                        sim('ClmStrategy', 'Paused', CLM.strategy, C_PAUSED, { account: CLM_KEEPER }),
                        sim('ClmStrategy', 'ClaimedFees', CLM.strategy, C_CLAIMED_FEES, {
                            feeMain0: 1n,
                            feeMain1: 2n,
                            feeAlt0: 3n,
                            feeAlt1: 4n,
                        }),
                    ] as never,
                },
            },
        });
        const harvests = new Map(rowsOf<Row>(result, 'Harvest').map((r) => [r.id, r]));
        expect(harvests.get(columns(C_CLAIMED).id)).toMatchObject({
            ...columns(C_CLAIMED),
            kind: 'CLM_CLAIMED_REWARDS',
            fees: 632696335367026n,
            strategy: CLM.strategy,
            harvester: undefined,
        });
        expect(harvests.get(columns(C_HARVEST_REWARDS).id)).toMatchObject({
            ...columns(C_HARVEST_REWARDS),
            kind: 'CLM_HARVEST_REWARDS',
            fees: 572590183507159n,
        });
        expect(harvests.get(columns(C_CLAIMED_FEES).id)).toMatchObject({
            ...columns(C_CLAIMED_FEES),
            kind: 'CLM_CLAIMED_FEES',
            feeMain0: 1n,
            feeMain1: 2n,
            feeAlt0: 3n,
            feeAlt1: 4n,
            fee0: undefined,
            fees: undefined,
        });
        expect(rowsOf(result, 'FeesCharged')).toEqual([
            {
                ...columns(C_FEES),
                strategy: CLM.strategy,
                family: 'CLM',
                version: 2,
                callFee: 23510111n,
                beefyFee: 21135590447n,
                strategistFee: 1175505586n,
                liquidityFee: undefined,
            },
        ]);
        expect(rowsOf(result, 'PauseChange')).toEqual([
            { ...columns(C_PAUSED), contract: CLM.strategy, paused: true, account: CLM_KEEPER },
        ]);
        // HarvestRewards / ClaimedRewards are not CLM TVL / Harvest events: no pool-state read for them
        expect(rowsOf(result, 'ClmPoolState')).toHaveLength(0);
    });
});

describe('reward pool rows (real reward pool 0x0ddf)', () => {
    it('NotifyReward and RewardPaid: raw amount / duration / reward token', async () => {
        const notify: Ev = { ...C_CLAIMED, logIndex: 383 };
        const paid: Ev = {
            block: 25116731,
            timestamp: 1737022809,
            hash: '0x9fba669452a18a626b692a8c8e10deb92578555e1dd621014269008a7c715ce6',
            from: CLM_KEEPER,
            logIndex: 169,
        };
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        {
                            contract: 'RewardPoolFactory',
                            event: 'RewardPoolCreatedWithName',
                            srcAddress: REWARD_POOL_FACTORY,
                            logIndex: CLM.rewardPoolCreation.logIndex,
                            block: { number: CLM.rewardPoolCreation.block, timestamp: 1737017067 },
                            transaction: { hash: CLM.rewardPoolCreation.hash, from: DEPLOYER },
                            params: { proxy: CLM.rewardPool, rewardPoolName: 'Beefy Reward Pool' },
                        },
                        sim('RewardPool', 'NotifyReward', CLM.rewardPool, notify, {
                            reward: AERO,
                            amount: 0x208c48a7d64d7n,
                            duration: 86400n,
                        }),
                        sim('RewardPool', 'RewardPaid', CLM.rewardPool, paid, {
                            user: CLM.clmVaultStrategy,
                            reward: AERO,
                            amount: 0x9ea1c50ec8bn,
                        }),
                    ] as never,
                },
            },
        });
        expect(rowsOf(result, 'RewardNotified')).toEqual([
            {
                ...columns(notify),
                contract: CLM.rewardPool,
                source: 'REWARD_POOL',
                rewardToken: AERO,
                amount: 572590183507159n,
                duration: 86400n,
            },
        ]);
        expect(rowsOf(result, 'RewardPaid')).toEqual([
            {
                ...columns(paid),
                contract: CLM.rewardPool,
                source: 'REWARD_POOL',
                user: CLM.clmVaultStrategy,
                rewardToken: AERO,
                amount: 10901102062731n,
            },
        ]);
    });
});

describe('swapper rows (real BeefySwapper 0x9f8c)', () => {
    const DATA_1 =
        '0xb858183f000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000800000000000000000000000009f8c6a094434c6e6f5f2792088bb4d2d5971ddcc00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002b833589fcd6edb6e08f4c7c32d4f71b54bda029130001f44200000000000000000000000000000000000006000000000000000000000000000000000000000000';
    const ROUTER = '0x2626664c2603336e57b271c5c0b26f421741e481';
    const init: Ev = {
        block: 15528925,
        timestamp: 1717847197,
        hash: '0xf040b5e8b74193449d9808452dfeaca78f4502cd920dddba983675e264b0cd48',
        from: SWAPPER_OWNER,
        logIndex: 164,
    };
    const swap1: Ev = {
        block: 15681915,
        timestamp: 1718153177,
        hash: '0x39bff96201a278c6cafc83d6dcc975184842c5dd21b8eede61f83b120c0af149',
        from: SWAPPER_OWNER,
        logIndex: 107,
    };
    const swap2: Ev = {
        block: 15682889,
        timestamp: 1718155125,
        hash: '0x11d3b434bf686be409bb9e682a63cfc36b05eebdb57655df3575cbadd1ee6eef',
        from: SWAPPER_OWNER,
        logIndex: 467,
    };
    const slippage: Ev = {
        block: 15686593,
        timestamp: 1718162533,
        hash: '0x3f68788794dd84982f627c73eb057ae395a2cc4050b0172cc9bacfa5ccb6312d',
        from: SWAPPER_OWNER,
        logIndex: 120,
    };
    const oracle: Ev = {
        block: 15686600,
        timestamp: 1718162547,
        hash: fakeHash(803),
        from: SWAPPER_OWNER,
        logIndex: 2,
    };
    const ORACLE = '0x1234567890abcdef1234567890abcdef12345678';

    it('Initialized / SetSwapInfo (x2, same pair) / SetSlippage / SetOracle', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        sim('BeefySwapper', 'Initialized', SWAPPER, init, { version: 1n }),
                        sim('BeefySwapper', 'SetSwapInfo', SWAPPER, swap1, {
                            fromToken: USDC,
                            toToken: WETH,
                            swapInfo: {
                                router: ROUTER,
                                data: DATA_1,
                                amountIndex: 132n,
                                minIndex: 164n,
                                minAmountSign: 0n,
                            },
                        }),
                        sim('BeefySwapper', 'SetSwapInfo', SWAPPER, swap2, {
                            fromToken: USDC,
                            toToken: WETH,
                            swapInfo: {
                                router: ROUTER,
                                data: DATA_1,
                                amountIndex: 100n,
                                minIndex: 132n,
                                minAmountSign: 0n,
                            },
                        }),
                        sim('BeefySwapper', 'SetSlippage', SWAPPER, slippage, { slippage: 930000000000000000n }),
                        sim('BeefySwapper', 'SetOracle', SWAPPER, oracle, { oracle: ORACLE }),
                    ] as never,
                },
            },
        });
        const changes = rowsOf<Row>(result, 'SwapperRouteChange');
        expect(changes.map((c) => [c.id, c.amountIndex, c.minIndex])).toEqual([
            [columns(swap1).id, 132n, 164n],
            [columns(swap2).id, 100n, 132n],
        ]);
        expect(changes[0]).toEqual({
            ...columns(swap1),
            swapper: SWAPPER,
            fromToken: USDC,
            toToken: WETH,
            router: ROUTER,
            data: DATA_1,
            amountIndex: 132n,
            minIndex: 164n,
            minAmountSign: 0,
        });
        const routes = latestById<Row>(result, 'SwapperRoute');
        expect([...routes.keys()]).toEqual([`${CHAIN}-${SWAPPER}-${USDC}-${WETH}`]);
        expect(routes.get(`${CHAIN}-${SWAPPER}-${USDC}-${WETH}`)).toMatchObject({
            amountIndex: 100n,
            minIndex: 132n,
            updatedBlock: 15682889n,
            updatedTimestamp: new Date(1718155125 * 1000),
            updatedTrxHash: swap2.hash,
        });
        const config = rowsOf<Row>(result, 'SwapperConfigChange');
        expect(config).toEqual([
            {
                ...columns(init),
                swapper: SWAPPER,
                kind: 'INITIALIZED',
                oracle: undefined,
                slippage: undefined,
                version: 1,
            },
            {
                ...columns(slippage),
                swapper: SWAPPER,
                kind: 'SET_SLIPPAGE',
                oracle: undefined,
                slippage: 930000000000000000n,
                version: undefined,
            },
            {
                ...columns(oracle),
                swapper: SWAPPER,
                kind: 'SET_ORACLE',
                oracle: ORACLE,
                slippage: undefined,
                version: undefined,
            },
        ]);
    });
});
