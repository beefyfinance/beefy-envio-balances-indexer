/**
 * Boosts (docs/architecture.md "Balances" -> BoostStake): Staked / Withdrawn write BoostStake rows AND a
 * BALANCE TimelineEvent + Balance keyed on the boost address (the balances API treats boosts as share tokens).
 * Real history of the static Base boost 0x31ea... is replayed; expected balances are on-chain boost
 * balanceOf(user) / totalSupply() at the last replayed block.
 */
import { createTestIndexer } from 'envio';
import * as R from 'remeda';
import { describe, expect, it } from 'vitest';

import { balanceRowsOf, latestById, rowsOf } from '../helpers/simulate';
import { BOOST_HISTORY, CHAIN, type RealBoostEvent } from './realData';

const BOOST = BOOST_HISTORY.boost;
const STAKED_TOKEN = '0xa6854c1f54198d351d6d4263806f5a876099839b';
const REWARD_TOKEN = '0xbbdeaaa32cbce61e0a2809edcae8d1857c55a5dd';

const item = (e: RealBoostEvent) => {
    const base = {
        contract: 'ClassicBoost' as const,
        srcAddress: BOOST,
        logIndex: e.logIndex,
        block: { number: e.block, timestamp: e.timestamp },
        transaction: { hash: e.hash, from: e.txFrom },
    };
    switch (e.event) {
        case 'Staked':
        case 'Withdrawn':
            return { ...base, event: e.event, params: { user: e.user, amount: e.amount } };
        case 'RewardPaid':
            return { ...base, event: e.event, params: { user: e.user, reward: e.amount } };
        case 'RewardAdded':
            return { ...base, event: e.event, params: { reward: e.amount } };
    }
};

type Row = Record<string, unknown> & { id: string };

const runAll = async () => {
    const indexer = createTestIndexer();
    const result = await indexer.process({
        // biome-ignore lint/suspicious/noExplicitAny: generated simulate union
        chains: { [CHAIN]: { simulate: BOOST_HISTORY.events.map(item) as any } },
    });
    return result;
};

describe('boost (real Base history)', () => {
    it('one BoostStake row per Staked / Withdrawn with raw amount, direction and event columns', async () => {
        const result = await runAll();
        const stakes = new Map(rowsOf<Row>(result, 'BoostStake').map((r) => [r.id, r]));
        const expected = BOOST_HISTORY.events.filter((e) => e.event === 'Staked' || e.event === 'Withdrawn');
        expect(stakes.size).toBe(expected.length);
        for (const e of expected) {
            expect(stakes.get(`${CHAIN}-${e.hash}-${e.logIndex}`)).toMatchObject({
                boost: BOOST,
                user: e.user,
                amount: e.amount,
                direction: e.event === 'Staked' ? 'STAKE' : 'UNSTAKE',
                blockNumber: BigInt(e.block),
                blockTimestamp: new Date(e.timestamp * 1000),
                trxHash: e.hash,
                trxFrom: e.txFrom,
                logIndex: e.logIndex,
            });
        }
    });

    it('Balance keyed on the boost matches on-chain boost.balanceOf(user); TokenSupply matches totalSupply()', async () => {
        const result = await runAll();
        const balances = latestById<Row & { balance: bigint }>(result, 'Balance');
        for (const [user, expected] of R.entries(BOOST_HISTORY.balances)) {
            expect(balances.get(`${CHAIN}-${BOOST}-${user}`)?.balance ?? 0n, user).toBe(expected);
        }
        expect(
            latestById<Row & { totalSupply: bigint }>(result, 'TokenSupply').get(`${CHAIN}-${BOOST}`)?.totalSupply
        ).toBe(BOOST_HISTORY.totalSupply);
    });

    it('BALANCE rows on the boost: source BOOST_STAKE, signed delta, running sharesAfter', async () => {
        const result = await runAll();
        const changes = new Map(balanceRowsOf(result).map((r) => [r.id, r]));
        const running = new Map<string, bigint>();
        let count = 0;
        for (const e of BOOST_HISTORY.events) {
            if (e.event !== 'Staked' && e.event !== 'Withdrawn') continue;
            const user = e.user as string;
            const delta = e.event === 'Staked' ? e.amount : -e.amount;
            const after = (running.get(user) ?? 0n) + delta;
            running.set(user, after);
            count++;
            expect(changes.get(`${CHAIN}-${e.hash}-${e.logIndex}-${user}-BALANCE`), e.hash).toMatchObject({
                contract: BOOST,
                account: user,
                delta,
                sharesAfter: after,
                source: 'BOOST_STAKE',
            });
        }
        expect(changes.size).toBe(count);
    });

    it('RewardAdded -> RewardNotified, RewardPaid -> RewardPaid: raw amounts, source BOOST, no reward token', async () => {
        const result = await runAll();
        const notified = rowsOf<Row>(result, 'RewardNotified');
        const added = BOOST_HISTORY.events.filter((e) => e.event === 'RewardAdded');
        expect(notified).toHaveLength(added.length);
        expect(notified[0]).toMatchObject({
            id: `${CHAIN}-${added[0]?.hash}-${added[0]?.logIndex}`,
            contract: BOOST,
            source: 'BOOST',
            amount: added[0]?.amount,
            rewardToken: undefined,
            duration: undefined,
        });
        const paid = new Map(rowsOf<Row>(result, 'RewardPaid').map((r) => [r.id, r]));
        const paidEvents = BOOST_HISTORY.events.filter((e) => e.event === 'RewardPaid');
        expect(paid.size).toBe(paidEvents.length);
        for (const e of paidEvents) {
            expect(paid.get(`${CHAIN}-${e.hash}-${e.logIndex}`)).toMatchObject({
                contract: BOOST,
                source: 'BOOST',
                user: e.user,
                amount: e.amount,
                trxFrom: e.txFrom,
            });
        }
    });

    it('boost facts: BOOST_STAKED / BOOST_REWARD READ links (on-chain stakedToken() / rewardToken())', async () => {
        const result = await runAll();
        const links = rowsOf<Row>(result, 'ContractLink').filter((l) => l.fromAddress === BOOST);
        expect(links.find((l) => l.relation === 'BOOST_STAKED')?.toAddress).toBe(STAKED_TOKEN);
        expect(links.find((l) => l.relation === 'BOOST_REWARD')?.toAddress).toBe(REWARD_TOKEN);
        expect(latestById<Row>(result, 'Contract').get(`${CHAIN}-${BOOST}`)).toMatchObject({ kind: 'BOOST' });
    });

    it('boost is a share token: Token row with isBeefyShare (schema.graphql Token.isBeefyShare lists boosts)', async () => {
        const result = await runAll();
        // the boost has no decimals() / symbol() / name() on-chain: metadataStatus INVALID is the expected raw fact
        expect(latestById<Row>(result, 'Token').get(`${CHAIN}-${BOOST}`)).toMatchObject({
            address: BOOST,
            isBeefyShare: true,
            metadataStatus: 'INVALID',
        });
    });
});
