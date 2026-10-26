import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

import { latestById, rowsOf, tx, USER_A, USER_B, ZERO } from '../../test/helpers/simulate';

describe('classic boost', () => {
    // Base launchpool listed in config.yaml (mooBaseSwap cbETH-WETH staked, ALB rewards)
    const BOOST = '0x01e8881ed2fb41e0b3df29f382faf707a0b26969' as const;
    const at = (offset: number) => ({ number: 2_578_061 + offset, timestamp: 1_691_945_469 + offset * 2 });
    const boostEvent = <E extends 'Staked' | 'Withdrawn'>(
        event: E,
        logIndex: number,
        user: `0x${string}`,
        amount: bigint,
        offset: number
    ) => ({
        contract: 'ClassicBoost' as const,
        event,
        srcAddress: BOOST,
        logIndex,
        block: at(offset),
        transaction: tx(logIndex + offset * 10, user),
        params: { user, amount },
    });

    it('tracks stakes as balances of the boost token', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        boostEvent('Staked', 1, USER_A, 100n, 0),
                        boostEvent('Staked', 2, USER_B, 50n, 0),
                        boostEvent('Withdrawn', 1, USER_A, 40n, 1),
                        {
                            contract: 'ClassicBoost',
                            event: 'RewardAdded',
                            srcAddress: BOOST,
                            logIndex: 2,
                            block: at(1),
                            transaction: tx(99),
                            params: { reward: 1_000n },
                        },
                        {
                            contract: 'ClassicBoost',
                            event: 'RewardPaid',
                            srcAddress: BOOST,
                            logIndex: 3,
                            block: at(1),
                            transaction: tx(11, USER_A),
                            params: { user: USER_A, reward: 7n },
                        },
                    ],
                },
            },
        });

        expect(rowsOf(result, 'BoostStake')).toEqual([
            expect.objectContaining({ boost: BOOST, user: USER_A, amount: 100n, direction: 'STAKE', trxFrom: USER_A }),
            expect.objectContaining({ boost: BOOST, user: USER_B, amount: 50n, direction: 'STAKE' }),
            expect.objectContaining({ boost: BOOST, user: USER_A, amount: 40n, direction: 'UNSTAKE' }),
        ]);
        expect(
            rowsOf<{ account: string; token: string; delta: bigint; balanceAfter: bigint; source: string }>(
                result,
                'BalanceChange'
            ).map(({ account, token, delta, balanceAfter, source }) => [account, token, delta, balanceAfter, source])
        ).toEqual([
            [USER_A, BOOST, 100n, 100n, 'BOOST_STAKE'],
            [USER_B, BOOST, 50n, 50n, 'BOOST_STAKE'],
            [USER_A, BOOST, -40n, 60n, 'BOOST_STAKE'],
        ]);
        expect(latestById(result, 'Balance').get(`8453-${BOOST}-${USER_A}`)).toMatchObject({ balance: 60n });
        expect(latestById(result, 'TokenSupply').get(`8453-${BOOST}`)).toMatchObject({ totalSupply: 110n });
        expect(rowsOf(result, 'RewardNotified')).toEqual([
            expect.objectContaining({
                contract: BOOST,
                source: 'BOOST',
                rewardToken: undefined,
                amount: 1_000n,
                duration: undefined,
            }),
        ]);
        expect(rowsOf(result, 'RewardPaid')).toEqual([
            expect.objectContaining({
                contract: BOOST,
                source: 'BOOST',
                user: USER_A,
                amount: 7n,
                rewardToken: undefined,
            }),
        ]);
        // staked / reward tokens read once; the boost gets a share Token row too (INVALID metadata: not an ERC-20)
        expect(latestById(result, 'Contract').get(`8453-${BOOST}`)).toMatchObject({ kind: 'BOOST', factsStatus: 'OK' });
        expect(rowsOf(result, 'ContractLink')).toMatchInlineSnapshot(`
          [
            {
              "fromAddress": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
              "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969-BOOST_STAKED-read",
              "logIndex": undefined,
              "relation": "BOOST_STAKED",
              "sinceBlock": 2578061n,
              "sinceTimestamp": 2023-08-13T16:51:09.000Z,
              "source": "READ",
              "toAddress": "0xa6854c1f54198d351d6d4263806f5a876099839b",
              "trxHash": undefined,
            },
            {
              "fromAddress": "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
              "id": "8453-0x01e8881ed2fb41e0b3df29f382faf707a0b26969-BOOST_REWARD-read",
              "logIndex": undefined,
              "relation": "BOOST_REWARD",
              "sinceBlock": 2578061n,
              "sinceTimestamp": 2023-08-13T16:51:09.000Z,
              "source": "READ",
              "toAddress": "0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
              "trxHash": undefined,
            },
          ]
        `);
        expect(rowsOf<{ address: string }>(result, 'Token').map(({ address }) => address)).toMatchInlineSnapshot(`
          [
            "0x01e8881ed2fb41e0b3df29f382faf707a0b26969",
            "0xa6854c1f54198d351d6d4263806f5a876099839b",
            "0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4",
          ]
        `);
    });
});

describe('reward pool', () => {
    // Ethereum reward pool listed in config.yaml
    const POOL = '0x5e3e4ed40e754254095f091aa51871d125f4380a' as const;
    const REWARD = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const; // USDC
    const at = (offset: number) => ({ number: 20_000_000 + offset, timestamp: 1_717_000_000 + offset * 12 });

    it('writes share transfers, reward links, notifications and claims', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                1: {
                    simulate: [
                        {
                            contract: 'RewardPool',
                            event: 'Transfer',
                            srcAddress: POOL,
                            logIndex: 1,
                            block: at(0),
                            transaction: tx(1, USER_A),
                            params: { from: ZERO, to: USER_A, value: 500n },
                        },
                        {
                            contract: 'RewardPool',
                            event: 'AddReward',
                            srcAddress: POOL,
                            logIndex: 2,
                            block: at(0),
                            transaction: tx(2),
                            params: { reward: REWARD },
                        },
                        {
                            contract: 'RewardPool',
                            event: 'NotifyReward',
                            srcAddress: POOL,
                            logIndex: 1,
                            block: at(1),
                            transaction: tx(3),
                            params: { reward: REWARD, amount: 9_000n, duration: 604_800n },
                        },
                        {
                            contract: 'RewardPool',
                            event: 'RewardPaid',
                            srcAddress: POOL,
                            logIndex: 2,
                            block: at(1),
                            transaction: tx(4, USER_A),
                            params: { user: USER_A, reward: REWARD, amount: 12n },
                        },
                    ],
                },
            },
        });

        expect(latestById(result, 'Balance').get(`1-${POOL}-${USER_A}`)).toMatchObject({ balance: 500n });
        expect(
            rowsOf<{ relation: string; source: string; toAddress: string }>(result, 'ContractLink').map(
                ({ relation, source, toAddress }) => [relation, source, toAddress]
            )
        ).toMatchInlineSnapshot(`
          [
            [
              "REWARD_POOL_STAKED",
              "READ",
              "0x6c9d885b37b131aa68794ee1549ffb80be381fa9",
            ],
            [
              "REWARD_POOL_REWARD",
              "EVENT",
              "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            ],
          ]
        `);
        expect(rowsOf(result, 'RewardNotified')).toEqual([
            expect.objectContaining({
                contract: POOL,
                source: 'REWARD_POOL',
                rewardToken: REWARD,
                amount: 9_000n,
                duration: 604_800n,
            }),
        ]);
        expect(rowsOf(result, 'RewardPaid')).toEqual([
            expect.objectContaining({
                contract: POOL,
                user: USER_A,
                rewardToken: REWARD,
                amount: 12n,
                trxFrom: USER_A,
            }),
        ]);
        expect(latestById(result, 'Token').get(`1-${REWARD}`)).toMatchObject({
            decimals: 6,
            symbol: 'USDC',
            isBeefyShare: false,
        });
    });
});
