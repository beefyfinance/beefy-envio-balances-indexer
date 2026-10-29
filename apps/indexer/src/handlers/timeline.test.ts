import { createTestIndexer, type TimelineEvent } from 'envio';
import type { Hex } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';

import { hash, rowsOf, tx, USER_A, USER_B, USER_C, ZERO } from '../../test/helpers/simulate';
import { type HeadPrice, setHeadPriceSource } from '../lib/headPrices';

// mooBIFI on Base, configured as a `Token` share token in config.yaml
const MOO_BIFI = '0xc55e93c62874d8100dbd2dfe307edc1036ad5434' as const;
const BLOCK = 17_452_334;
const TS = 1_718_500_600;
// a zap router: any account, there is no router list
const ZAP = '0x6f19da51d488926c007b9ebaa5968291a2ec6a63' as const;
const FEE = '0x2222222222222222222222222222222222222222' as const;

/** A mooBIFI transfer of transaction `tag`, in block `BLOCK + tag`. */
const transfer = (tag: number, logIndex: number, from: Hex, to: Hex, value: bigint) => ({
    contract: 'Token' as const,
    event: 'Transfer' as const,
    srcAddress: MOO_BIFI,
    logIndex,
    block: { number: BLOCK + tag, timestamp: TS + tag * 2 },
    transaction: tx(tag),
    params: { from, to, value },
});

const timelineOf = async (simulate: ReturnType<typeof transfer>[]) => {
    const result = await createTestIndexer().process({ chains: { 8453: { simulate } } });
    return rowsOf<TimelineEvent>(result, 'TimelineEvent');
};

/** One `trx tag/log account kind delta sharesAfter` line per row, sorted (the sides of one event are written concurrently). */
const lines = (rows: TimelineEvent[]) =>
    rows
        .map(
            ({ trxHash, logIndex, account, kind, delta, sharesAfter }) =>
                `${Number(BigInt(trxHash))}/${logIndex} ${account} ${kind} ${delta} ${sharesAfter}`
        )
        .sort();

describe('timeline of share transfers', () => {
    it('writes both balance sides, the mint for the receiver and the burn for the sender', async () => {
        const rows = await timelineOf([
            transfer(1, 1, ZERO, USER_A, 100n),
            transfer(2, 1, USER_A, USER_B, 30n),
            transfer(3, 1, USER_A, ZERO, 20n),
        ]);

        expect(lines(rows)).toEqual([
            `1/1 ${USER_A} BALANCE 100 100`,
            `1/1 ${USER_A} MINT 0 0`,
            `2/1 ${USER_B} BALANCE 30 30`,
            `2/1 ${USER_A} BALANCE -30 70`,
            `3/1 ${USER_A} BALANCE -20 50`,
            `3/1 ${USER_A} BURN 0 0`,
        ]);
        expect(rows.find(({ kind }) => kind === 'BALANCE')).toEqual({
            id: `8453-${hash(1)}-1-${USER_A}-BALANCE`,
            account: USER_A,
            kind: 'BALANCE',
            contract: MOO_BIFI,
            source: 'TRANSFER',
            delta: 100n,
            sharesAfter: 100n,
            amount0: 0n,
            amount1: 0n,
            rewardToken: '',
            rewardAmount: 0n,
            blockNumber: BigInt(BLOCK + 1),
            blockTimestamp: new Date((TS + 2) * 1000),
            logIndex: 1,
            trxHash: hash(1),
        });
        expect(rows.find(({ kind }) => kind === 'MINT')).toMatchObject({
            id: `8453-${hash(1)}-1-${USER_A}-MINT`,
            contract: MOO_BIFI,
            source: '',
        });
    });

    it('marks a deposit through a router for the account the router forwards the minted shares to', async () => {
        const rows = await timelineOf([transfer(1, 1, ZERO, ZAP, 100n), transfer(1, 2, ZAP, USER_A, 100n)]);

        expect(rows.filter(({ kind }) => kind === 'MINT').map(({ id }) => id)).toEqual([
            `8453-${hash(1)}-1-${ZAP}-MINT`,
            `8453-${hash(1)}-2-${USER_A}-MINT`,
        ]);
        expect(rows.find(({ id }) => id === `8453-${hash(1)}-2-${USER_A}-MINT`)).toMatchObject({
            account: USER_A,
            contract: MOO_BIFI,
            logIndex: 2,
            delta: 0n,
        });
    });

    it('marks a withdrawal through a router for the account that sent it the burned shares, at its transfer', async () => {
        const rows = await timelineOf([
            transfer(1, 1, ZERO, USER_A, 40n),
            transfer(2, 1, USER_A, ZAP, 40n),
            transfer(2, 2, ZAP, ZERO, 40n),
        ]);

        expect(rows.filter(({ kind }) => kind === 'BURN').map(({ id }) => id)).toEqual([
            `8453-${hash(2)}-2-${ZAP}-BURN`,
            `8453-${hash(2)}-1-${USER_A}-BURN`,
        ]);
        expect(rows.find(({ id }) => id === `8453-${hash(2)}-1-${USER_A}-BURN`)).toMatchObject({
            account: USER_A,
            contract: MOO_BIFI,
            logIndex: 1,
            blockNumber: BigInt(BLOCK + 2),
            trxHash: hash(2),
        });
    });

    it('does not mark a transfer between two people, even of a value minted in an earlier transaction', async () => {
        const rows = await timelineOf([
            transfer(1, 1, ZERO, USER_A, 50n),
            transfer(2, 1, USER_A, USER_B, 50n),
            transfer(3, 1, USER_B, USER_C, 50n),
            transfer(4, 1, USER_C, ZERO, 10n),
        ]);

        expect(
            rows
                .filter(({ kind }) => kind !== 'BALANCE')
                .map(({ account, kind, logIndex, trxHash }) => [trxHash, logIndex, account, kind])
        ).toEqual([
            [hash(1), 1, USER_A, 'MINT'],
            [hash(4), 1, USER_C, 'BURN'],
        ]);
    });

    it('leaves a plain transfer when a fee breaks the amount match', async () => {
        const rows = await timelineOf([
            // deposit: the router keeps 1 of the 100 minted shares
            transfer(1, 1, ZERO, ZAP, 100n),
            transfer(1, 2, ZAP, FEE, 1n),
            transfer(1, 3, ZAP, USER_A, 99n),
            // withdrawal: the router burns 99 of the 100 shares it received
            transfer(2, 1, USER_A, ZAP, 99n),
            transfer(2, 2, ZAP, FEE, 1n),
            transfer(2, 3, ZAP, ZERO, 98n),
        ]);

        expect(rows.filter(({ kind }) => kind !== 'BALANCE').map(({ account, kind }) => [account, kind])).toEqual([
            [ZAP, 'MINT'],
            [ZAP, 'BURN'],
        ]);
    });
});

describe('timeline of CLM deposits and withdrawals', () => {
    // Cow Sushi Base WETH-USDC (src/handlers/clm.test.ts)
    const MANAGER_FACTORY = '0x7bc78990ac1ef0754cfde935b2d84e9acf13ed29' as const;
    const MANAGER = '0x603492ff8943f5ac69aa69cf09fc96fda2606ee7' as const;
    const INIT = { number: 15_683_455, timestamp: Math.floor(Date.parse('2024-07-15T12:00:00.000Z') / 1000) };
    const block = { number: 17_452_460, timestamp: 1_721_694_267 };

    it('writes the underlying amounts for the user', async () => {
        const result = await createTestIndexer().process({
            chains: {
                8453: {
                    simulate: [
                        {
                            contract: 'ClmManagerFactory',
                            event: 'ClmManagerCreated',
                            srcAddress: MANAGER_FACTORY,
                            logIndex: 1,
                            block: INIT,
                            transaction: tx(1),
                            params: { proxy: MANAGER },
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

        expect(rowsOf(result, 'TimelineEvent')).toEqual([
            {
                id: `8453-${hash(2)}-2-${USER_A}-CLM_DEPOSIT`,
                account: USER_A,
                kind: 'CLM_DEPOSIT',
                contract: MANAGER,
                source: '',
                delta: 0n,
                sharesAfter: 0n,
                amount0: 11n,
                amount1: 22n,
                rewardToken: '',
                rewardAmount: 0n,
                blockNumber: BigInt(block.number),
                blockTimestamp: new Date(block.timestamp * 1000),
                logIndex: 2,
                trxHash: hash(2),
                // price facts known (a CLM is priced per its own share decimals), no price: a historical event
                headProduct: MANAGER,
                headDecimals: 18,
                headProductKind: 'CLM_MANAGER',
                headContractKind: 'CLM_MANAGER',
            },
            expect.objectContaining({
                id: `8453-${hash(3)}-1-${USER_A}-CLM_WITHDRAW`,
                kind: 'CLM_WITHDRAW',
                contract: MANAGER,
                amount0: 4n,
                amount1: 9n,
            }),
        ]);
    });
});

describe('timeline of reward claims', () => {
    it('writes reward pool claims with their token', async () => {
        // Ethereum reward pool listed in config.yaml, USDC rewards (src/handlers/rewards.test.ts)
        const POOL = '0x5e3e4ed40e754254095f091aa51871d125f4380a' as const;
        const REWARD = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const;
        const result = await createTestIndexer().process({
            chains: {
                1: {
                    simulate: [
                        {
                            contract: 'RewardPool',
                            event: 'RewardPaid',
                            srcAddress: POOL,
                            logIndex: 2,
                            block: { number: 20_000_001, timestamp: 1_717_000_012 },
                            transaction: tx(4, USER_A),
                            params: { user: USER_A, reward: REWARD, amount: 12n },
                        },
                    ],
                },
            },
        });

        expect(rowsOf(result, 'TimelineEvent')).toEqual([
            expect.objectContaining({
                id: `1-${hash(4)}-2-${USER_A}-CLAIM`,
                account: USER_A,
                kind: 'CLAIM',
                contract: POOL,
                rewardToken: REWARD,
                rewardAmount: 12n,
                delta: 0n,
            }),
        ]);
    });

    it('writes boost stakes as balance changes of the boost, and boost claims without a token', async () => {
        // Base launchpool listed in config.yaml (src/handlers/rewards.test.ts)
        const BOOST = '0x01e8881ed2fb41e0b3df29f382faf707a0b26969' as const;
        const result = await createTestIndexer().process({
            chains: {
                8453: {
                    simulate: [
                        {
                            contract: 'ClassicBoost',
                            event: 'Staked',
                            srcAddress: BOOST,
                            logIndex: 1,
                            block: { number: 2_578_061, timestamp: 1_691_945_469 },
                            transaction: tx(10, USER_A),
                            params: { user: USER_A, amount: 100n },
                        },
                        {
                            contract: 'ClassicBoost',
                            event: 'RewardPaid',
                            srcAddress: BOOST,
                            logIndex: 3,
                            block: { number: 2_578_062, timestamp: 1_691_945_471 },
                            transaction: tx(11, USER_A),
                            params: { user: USER_A, reward: 7n },
                        },
                    ],
                },
            },
        });

        expect(rowsOf(result, 'TimelineEvent')).toEqual([
            expect.objectContaining({
                id: `8453-${hash(10)}-1-${USER_A}-BALANCE`,
                kind: 'BALANCE',
                contract: BOOST,
                source: 'BOOST_STAKE',
                delta: 100n,
                sharesAfter: 100n,
            }),
            expect.objectContaining({
                id: `8453-${hash(11)}-3-${USER_A}-CLAIM`,
                kind: 'CLAIM',
                contract: BOOST,
                rewardToken: '',
                rewardAmount: 7n,
            }),
        ]);
    });
});

describe('indexer prices', () => {
    // BSC vault listed in config.yaml, 1INCH want (18 decimals) (src/handlers/classic.test.ts)
    const VAULT = '0xba53af4c2f1649f82e8070fb306ddbf2771a1950' as const;
    // Base launchpool staking the mooBaseSwap cbETH-WETH vault (src/handlers/rewards.test.ts)
    const BOOST = '0x01e8881ed2fb41e0b3df29f382faf707a0b26969' as const;
    const BOOST_VAULT = '0xa6854c1f54198d351d6d4263806f5a876099839b' as const;
    const TS_VAULT = 1_635_328_565;
    const TS_BOOST = 1_691_945_469;
    const VAULT_FACTS = { headProduct: VAULT, headDecimals: 18, headProductKind: 'VAULT', headContractKind: 'VAULT' };
    const UNPRICED = { headPrice: undefined, headPriceAt: undefined };

    /** Prices of `products` (per chain id), all fetched at `fetchedAt`; the clock reads `now`. */
    const usePrices = (prices: Record<number, Record<string, number>>, fetchedAt: number, now: number) =>
        setHeadPriceSource(
            {
                get: (chainId, product): HeadPrice | undefined => {
                    const price = prices[chainId]?.[product];
                    return price === undefined ? undefined : { price, fetchedAt };
                },
            },
            () => now
        );

    afterEach(() => setHeadPriceSource(undefined));

    const vaultTransfer = (tag: number, timestamp: number) => ({
        contract: 'ClassicVault' as const,
        event: 'Transfer' as const,
        srcAddress: VAULT,
        logIndex: 1,
        block: { number: 12_132_390 + tag, timestamp },
        transaction: tx(tag, USER_A),
        params: { from: ZERO, to: USER_A, value: 1_000n },
    });

    const vaultTimeline = async (simulate: ReturnType<typeof vaultTransfer>[]) => {
        const result = await createTestIndexer().process({ chains: { 56: { simulate } } });
        return rowsOf<TimelineEvent>(result, 'TimelineEvent');
    };

    const heads = (rows: TimelineEvent[]) =>
        rows.map(({ kind, headPrice, headPriceAt, headProduct, headDecimals, headProductKind, headContractKind }) => ({
            kind,
            headPrice,
            headPriceAt,
            headProduct,
            headDecimals,
            headProductKind,
            headContractKind,
        }));

    it('prices a recent event with a recent price, per the want decimals of a classic vault', async () => {
        const now = (TS_VAULT + 9 * 60) * 1000;
        usePrices({ 56: { [VAULT]: 1.25 } }, now - 14 * 60_000, now);
        const rows = await vaultTimeline([vaultTransfer(1, TS_VAULT)]);

        const priced = { headPrice: 1.25, headPriceAt: new Date(now - 14 * 60_000), ...VAULT_FACTS };
        expect(heads(rows)).toEqual([
            { kind: 'MINT', ...priced },
            { kind: 'BALANCE', ...priced },
        ]);
    });

    it('keeps the price facts but no price on an old event, an old price and an unlisted product', async () => {
        const now = (TS_VAULT + 11 * 60) * 1000;
        const unpriced = [
            { kind: 'MINT', ...UNPRICED, ...VAULT_FACTS },
            { kind: 'BALANCE', ...UNPRICED, ...VAULT_FACTS },
        ];

        // the event is more than 10 minutes old
        usePrices({ 56: { [VAULT]: 1.25 } }, now, now);
        expect(heads(await vaultTimeline([vaultTransfer(1, TS_VAULT)]))).toEqual(unpriced);

        // the price is more than 15 minutes old
        usePrices({ 56: { [VAULT]: 1.25 } }, now - 16 * 60_000, now);
        expect(heads(await vaultTimeline([vaultTransfer(1, TS_VAULT + 120)]))).toEqual(unpriced);

        // no price for the product (another chain's)
        usePrices({ 8453: { [VAULT]: 1.25 } }, now, now);
        expect(heads(await vaultTimeline([vaultTransfer(1, TS_VAULT + 120)]))).toEqual(unpriced);
    });

    it('leaves a contract without price facts empty', async () => {
        const now = (TS + 62) * 1000;
        usePrices({ 8453: { [MOO_BIFI]: 3 } }, now, now);
        const rows = await timelineOf([transfer(1, 1, ZERO, USER_A, 100n)]);

        expect(heads(rows)).toEqual(
            ['MINT', 'BALANCE'].map((kind) =>
                expect.objectContaining({
                    kind,
                    ...UNPRICED,
                    headProduct: undefined,
                    headDecimals: undefined,
                    headProductKind: undefined,
                    headContractKind: undefined,
                })
            )
        );
    });

    it('prices boost stakes and claims with the price of the vault it stakes', async () => {
        const now = (TS_BOOST + 60) * 1000;
        usePrices({ 8453: { [BOOST_VAULT]: 2.5, [BOOST]: 99 } }, now, now);
        const indexer = createTestIndexer();
        // the staked vault, registered with its want read (6 decimals here) before the boost's first event
        indexer.Contract.set({
            id: `8453-${BOOST_VAULT}`,
            chainId: 8453,
            address: BOOST_VAULT,
            kind: 'VAULT',
            factory: undefined,
            createdBlock: undefined,
            createdTimestamp: undefined,
            createdTrxHash: undefined,
            deployName: undefined,
            factsBlock: 2_578_000n,
            factsStatus: 'OK',
            productAddress: BOOST_VAULT,
            priceDecimals: 6,
            productKind: 'VAULT',
        });
        const result = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        {
                            contract: 'ClassicBoost',
                            event: 'Staked',
                            srcAddress: BOOST,
                            logIndex: 1,
                            block: { number: 2_578_061, timestamp: TS_BOOST },
                            transaction: tx(10, USER_A),
                            params: { user: USER_A, amount: 100n },
                        },
                        {
                            contract: 'ClassicBoost',
                            event: 'RewardPaid',
                            srcAddress: BOOST,
                            logIndex: 3,
                            block: { number: 2_578_062, timestamp: TS_BOOST + 2 },
                            transaction: tx(11, USER_A),
                            params: { user: USER_A, reward: 7n },
                        },
                    ],
                },
            },
        });

        const priced = {
            headPrice: 2.5,
            headPriceAt: new Date(now),
            headProduct: BOOST_VAULT,
            headDecimals: 6,
            headProductKind: 'VAULT',
            headContractKind: 'BOOST',
        };
        expect(heads(rowsOf<TimelineEvent>(result, 'TimelineEvent'))).toEqual([
            { kind: 'BALANCE', ...priced },
            { kind: 'CLAIM', ...priced },
        ]);
    });
});
