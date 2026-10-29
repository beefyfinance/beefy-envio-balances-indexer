/**
 * Running balances (docs/architecture.md "Balances"): ShareTransfer, BALANCE TimelineEvent rows (delta / sharesAfter),
 * Balance, TokenSupply and ShareTransfer.totalSupplyAfter (mint / burn only).
 *
 * Real Base vault V and CLM manager histories are replayed and the end state is compared to on-chain
 * balanceOf / totalSupply. Synthetic sequences then cover the edge cases.
 */
import { createTestIndexer } from 'envio';
import * as R from 'remeda';
import { describe, expect, it } from 'vitest';

import { balanceRowsOf, latestById, rowsOf } from '../helpers/simulate';
import { fakeHash, transferItem, vaultCreated, vaultInitialized } from './harness';
import {
    CHAIN,
    CLM,
    CLM_MANAGER_FACTORY,
    CLM_MANAGER_HISTORY,
    type RealTransfer,
    VAULT,
    VAULT_HISTORY,
} from './realData';

const ZERO = '0x0000000000000000000000000000000000000000';
const A = '0x00000000000000000000000000000000000a11ce';
const B = '0x00000000000000000000000000000000000b0b00';
const C = '0x0000000000000000000000000000000000000ca7';

type BalanceRow = { id: string; token: string; account: string; balance: bigint; lastChangeBlock: bigint };
type SupplyRow = { id: string; token: string; totalSupply: bigint; lastChangeBlock: bigint };
type ShareTransferRow = {
    id: string;
    token: string;
    fromAddress: string;
    toAddress: string;
    value: bigint;
    totalSupplyAfter?: bigint;
    blockNumber: bigint;
    logIndex: number;
};

const V = VAULT.address;

/** Base items: vault V created and initialized (so later Transfers reach a handler). */
const vaultSetup = () => [vaultCreated(), vaultInitialized()];

/** Synthetic transfer on vault V, after its initialization block. */
let synthetic = 0;
const tx = (
    block: number,
    logIndex: number,
    from: string,
    to: string,
    value: bigint,
    hashTag?: number
): RealTransfer => ({
    block,
    timestamp: 1736910000 + (block - 25059000) * 2,
    logIndex,
    hash: fakeHash(hashTag ?? ++synthetic),
    txFrom: '0x000000000000000000000000000000000000beef',
    from: from as `0x${string}`,
    to: to as `0x${string}`,
    value,
});

describe('real vault history (Base vault 0xf1ba...)', () => {
    it('Balance and TokenSupply match on-chain balanceOf / totalSupply after replaying every Transfer', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        ...vaultSetup(),
                        ...VAULT_HISTORY.transfers.map((t) => transferItem('ClassicVault', V, t)),
                    ],
                },
            },
        });

        const balances = latestById<BalanceRow>(result, 'Balance');
        for (const [account, expected] of R.entries(VAULT_HISTORY.balances)) {
            if (account === ZERO) continue; // mint / burn side: TokenSupply
            expect(balances.get(`${CHAIN}-${V}-${account}`)?.balance ?? 0n, `balance of ${account}`).toBe(expected);
        }
        const supply = latestById<SupplyRow>(result, 'TokenSupply').get(`${CHAIN}-${V}`);
        expect(supply?.totalSupply).toBe(VAULT_HISTORY.totalSupply);

        // one ShareTransfer per Transfer, with the exact raw value
        const transfers = rowsOf<ShareTransferRow>(result, 'ShareTransfer');
        expect(transfers).toHaveLength(VAULT_HISTORY.transfers.length);
        for (const t of VAULT_HISTORY.transfers) {
            const row = transfers.find((r) => r.id === `${CHAIN}-${t.hash}-${t.logIndex}`);
            expect(row).toMatchObject({ token: V, fromAddress: t.from, toAddress: t.to, value: t.value });
        }
    });

    it('BALANCE sharesAfter is the running sum of deltas per account (step function)', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        ...vaultSetup(),
                        ...VAULT_HISTORY.transfers.map((t) => transferItem('ClassicVault', V, t)),
                    ],
                },
            },
        });
        const changes = balanceRowsOf(result);

        // expected: every side of every transfer except 0x0 (zaps included), in (block, logIndex) order
        const expected: Array<{ id: string; account: string; delta: bigint; balanceAfter: bigint }> = [];
        const running = new Map<string, bigint>();
        for (const t of VAULT_HISTORY.transfers) {
            for (const [account, delta] of [
                [t.from, -t.value],
                [t.to, t.value],
            ] as const) {
                if (account === ZERO) continue;
                const after = (running.get(account) ?? 0n) + delta;
                running.set(account, after);
                expected.push({
                    id: `${CHAIN}-${t.hash}-${t.logIndex}-${account}-BALANCE`,
                    account,
                    delta,
                    balanceAfter: after,
                });
            }
        }
        const byId = new Map(changes.map((c) => [c.id, c]));
        expect(byId.size).toBe(expected.length);
        for (const e of expected) {
            expect(byId.get(e.id), e.id).toMatchObject({
                contract: V,
                account: e.account,
                delta: e.delta,
                sharesAfter: e.balanceAfter,
                source: 'TRANSFER',
            });
        }
    });

    it('ShareTransfer.totalSupplyAfter is set on mints / burns only and equals the running supply', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        ...vaultSetup(),
                        ...VAULT_HISTORY.transfers.map((t) => transferItem('ClassicVault', V, t)),
                    ],
                },
            },
        });
        const rows = new Map(rowsOf<ShareTransferRow>(result, 'ShareTransfer').map((r) => [r.id, r]));
        let supply = 0n;
        for (const t of VAULT_HISTORY.transfers) {
            const row = rows.get(`${CHAIN}-${t.hash}-${t.logIndex}`);
            if (t.from === ZERO) supply += t.value;
            if (t.to === ZERO) supply -= t.value;
            const isMintOrBurn = t.from === ZERO || t.to === ZERO;
            expect(row?.totalSupplyAfter, `${t.hash}-${t.logIndex}`).toBe(isMintOrBurn ? supply : undefined);
        }
        expect(supply).toBe(VAULT_HISTORY.totalSupply);
    });
});

describe('real CLM manager history (Base manager 0x8145...)', () => {
    it('balances across zap -> classic vault -> strategy -> reward pool hops (share token held by share tokens)', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        {
                            contract: 'ClmManagerFactory',
                            event: 'ClmManagerCreated',
                            srcAddress: CLM_MANAGER_FACTORY,
                            logIndex: CLM.managerCreation.logIndex,
                            block: { number: CLM.managerCreation.block, timestamp: 1736018000 },
                            transaction: {
                                hash: CLM.managerCreation.hash,
                                from: '0x982f264ce97365864181df65df4931c593a515ad',
                            },
                            params: { proxy: CLM.manager },
                        },
                        ...CLM_MANAGER_HISTORY.transfers.map((t) => transferItem('ClmManager', CLM.manager, t)),
                    ],
                },
            },
        });
        const balances = latestById<BalanceRow>(result, 'Balance');
        for (const [account, expected] of R.entries(CLM_MANAGER_HISTORY.balances)) {
            if (account === ZERO) continue;
            expect(balances.get(`${CHAIN}-${CLM.manager}-${account}`)?.balance ?? 0n, account).toBe(expected);
        }
        const supply = latestById<SupplyRow>(result, 'TokenSupply').get(`${CHAIN}-${CLM.manager}`);
        expect(supply?.totalSupply).toBe(CLM_MANAGER_HISTORY.totalSupply);

        // several transfers in one tx (same block, increasing logIndex): sharesAfter follows logIndex order
        const changes = balanceRowsOf(result).filter((c) => c.account === CLM.clmVaultStrategy);
        const sorted = [...changes].sort((a, b) =>
            a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)
        );
        let running = 0n;
        for (const c of sorted) {
            running += c.delta;
            expect(c.sharesAfter, c.id).toBe(running);
        }
        expect(running).toBe(0n); // the strategy only forwards shares
    });
});

describe('configured non-vault share token (mooBIFI on Base, config.yaml Token)', () => {
    it('Transfer -> ShareTransfer + balances; Contract kind TOKEN; Token row isBeefyShare', async () => {
        const MOOBIFI = '0xc55e93c62874d8100dbd2dfe307edc1036ad5434';
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        transferItem('Token', MOOBIFI, tx(25059000, 3, A, B, 5n)),
                        transferItem('Token', MOOBIFI, tx(25059001, 3, ZERO, A, 9n)),
                    ],
                },
            },
        });
        expect(rowsOf(result, 'ShareTransfer')).toHaveLength(2);
        const balances = latestById<BalanceRow>(result, 'Balance');
        expect(balances.get(`${CHAIN}-${MOOBIFI}-${A}`)?.balance).toBe(4n);
        expect(balances.get(`${CHAIN}-${MOOBIFI}-${B}`)?.balance).toBe(5n);
        expect(latestById<{ id: string; kind: string }>(result, 'Contract').get(`${CHAIN}-${MOOBIFI}`)?.kind).toBe(
            'TOKEN'
        );
        expect(
            latestById<{ id: string; isBeefyShare: boolean }>(result, 'Token').get(`${CHAIN}-${MOOBIFI}`)?.isBeefyShare
        ).toBe(true);
    });
});

describe('synthetic sequences on vault V', () => {
    const run = async (transfers: RealTransfer[]) => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: { simulate: [...vaultSetup(), ...transfers.map((t) => transferItem('ClassicVault', V, t))] },
            },
        });
        return { indexer, result };
    };

    it('mint, transfer, burn: deltas, sharesAfter, Balance, supply', async () => {
        const { result } = await run([
            tx(25059000, 1, ZERO, A, 1000n),
            tx(25059001, 1, A, B, 300n),
            tx(25059002, 1, B, ZERO, 100n),
        ]);
        const changes = balanceRowsOf(result).map((c) => [Number(c.blockNumber), c.account, c.delta, c.sharesAfter]);
        expect(changes).toEqual([
            [25059000, A, 1000n, 1000n],
            [25059001, A, -300n, 700n],
            [25059001, B, 300n, 300n],
            [25059002, B, -100n, 200n],
        ]);
        const balances = latestById<BalanceRow>(result, 'Balance');
        expect(balances.get(`${CHAIN}-${V}-${A}`)).toMatchObject({ balance: 700n, lastChangeBlock: 25059001n });
        expect(balances.get(`${CHAIN}-${V}-${B}`)).toMatchObject({ balance: 200n, lastChangeBlock: 25059002n });
        expect(balances.has(`${CHAIN}-${V}-${ZERO}`)).toBe(false);
        expect(latestById<SupplyRow>(result, 'TokenSupply').get(`${CHAIN}-${V}`)).toMatchObject({
            totalSupply: 900n,
            lastChangeBlock: 25059002n,
        });
        const supplyAfter = rowsOf<ShareTransferRow>(result, 'ShareTransfer').map((r) => r.totalSupplyAfter);
        expect(supplyAfter).toEqual([1000n, undefined, 900n]);
    });

    it('many transfers in the same block and same tx are applied in logIndex order', async () => {
        const h = 9001;
        const { result } = await run([
            tx(25059010, 5, ZERO, A, 50n, h),
            tx(25059010, 6, A, B, 20n, h),
            tx(25059010, 7, B, C, 20n, h),
            tx(25059010, 8, A, C, 30n, h),
            tx(25059010, 9, C, ZERO, 45n, h),
        ]);
        const changes = balanceRowsOf(result);
        const view = changes.map((c) => [c.logIndex, c.account, c.delta, c.sharesAfter]);
        expect(view).toEqual([
            [5, A, 50n, 50n],
            [6, A, -20n, 30n],
            [6, B, 20n, 20n],
            [7, B, -20n, 0n],
            [7, C, 20n, 20n],
            [8, A, -30n, 0n],
            [8, C, 30n, 50n],
            [9, C, -45n, 5n],
        ]);
        const ids = changes.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(latestById<SupplyRow>(result, 'TokenSupply').get(`${CHAIN}-${V}`)?.totalSupply).toBe(5n);
    });

    it('an account that goes to zero then back gets a 0 sharesAfter step and a fresh positive one', async () => {
        const { result } = await run([
            tx(25059020, 1, ZERO, A, 10n),
            tx(25059021, 1, A, ZERO, 10n),
            tx(25059022, 1, ZERO, A, 7n),
        ]);
        const steps = balanceRowsOf(result).map((c) => c.sharesAfter);
        expect(steps).toEqual([10n, 0n, 7n]);
        const balance = latestById<BalanceRow>(result, 'Balance').get(`${CHAIN}-${V}-${A}`);
        expect(balance).toMatchObject({ balance: 7n, lastChangeBlock: 25059022n });
        const supplyAfter = rowsOf<ShareTransferRow>(result, 'ShareTransfer').map((r) => r.totalSupplyAfter);
        expect(supplyAfter).toEqual([10n, 0n, 7n]);
    });

    it('self-transfer: ShareTransfer written, balance unchanged, no supply change', async () => {
        const { result } = await run([tx(25059030, 1, ZERO, A, 10n), tx(25059031, 1, A, A, 4n)]);
        const transfers = rowsOf<ShareTransferRow>(result, 'ShareTransfer');
        expect(transfers).toHaveLength(2);
        expect(transfers[1]).toMatchObject({ fromAddress: A, toAddress: A, value: 4n, totalSupplyAfter: undefined });
        // whatever rows the self-transfer writes, they must net to zero and leave sharesAfter at 10
        const selfChanges = balanceRowsOf(result).filter((c) => c.blockNumber === 25059031n);
        expect(selfChanges.reduce((s, c) => s + c.delta, 0n)).toBe(0n);
        for (const c of selfChanges) expect([6n, 10n]).toContain(c.sharesAfter);
        expect(latestById<BalanceRow>(result, 'Balance').get(`${CHAIN}-${V}-${A}`)?.balance).toBe(10n);
        expect(latestById<SupplyRow>(result, 'TokenSupply').get(`${CHAIN}-${V}`)?.totalSupply).toBe(10n);
    });

    it('zero-value transfer: ShareTransfer written, balances unchanged', async () => {
        const { result } = await run([tx(25059040, 1, ZERO, A, 10n), tx(25059041, 1, A, B, 0n)]);
        const transfers = rowsOf<ShareTransferRow>(result, 'ShareTransfer');
        expect(transfers[1]).toMatchObject({ fromAddress: A, toAddress: B, value: 0n });
        const later = balanceRowsOf(result).filter((c) => c.blockNumber === 25059041n);
        for (const c of later) expect(c.delta).toBe(0n);
        const balances = latestById<BalanceRow>(result, 'Balance');
        expect(balances.get(`${CHAIN}-${V}-${A}`)?.balance).toBe(10n);
        expect(balances.get(`${CHAIN}-${V}-${B}`)?.balance ?? 0n).toBe(0n);
    });

    it('zero-value mint does not move supply but still reports totalSupplyAfter', async () => {
        const { result } = await run([tx(25059050, 1, ZERO, A, 10n), tx(25059051, 1, ZERO, B, 0n)]);
        const transfers = rowsOf<ShareTransferRow>(result, 'ShareTransfer');
        expect(transfers.map((t) => t.totalSupplyAfter)).toEqual([10n, 10n]);
    });

    it('event columns of ShareTransfer / BALANCE rows come from the simulated event', async () => {
        const t = tx(25059060, 42, ZERO, A, 10n, 4242);
        const { result } = await run([t]);
        const columns = {
            blockNumber: 25059060n,
            blockTimestamp: new Date(t.timestamp * 1000),
            trxHash: t.hash,
            trxFrom: t.txFrom,
            logIndex: 42,
        };
        expect(rowsOf(result, 'ShareTransfer')[0]).toMatchObject({ ...columns, id: `${CHAIN}-${t.hash}-42` });
        const { trxFrom: _trxFrom, ...timelineColumns } = columns;
        expect(balanceRowsOf(result)[0]).toMatchObject({
            ...timelineColumns,
            id: `${CHAIN}-${t.hash}-42-${A}-BALANCE`,
        });
    });

    it('state persists across process() calls on one indexer (running sums continue)', async () => {
        const indexer = createTestIndexer();
        await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [...vaultSetup(), transferItem('ClassicVault', V, tx(25059070, 1, ZERO, A, 10n))],
                },
            },
        });
        const second = await indexer.process({
            chains: { [CHAIN]: { simulate: [transferItem('ClassicVault', V, tx(25059071, 1, A, B, 4n))] } },
        });
        expect(balanceRowsOf(second).map((c) => [c.account, c.sharesAfter])).toEqual([
            [A, 6n],
            [B, 4n],
        ]);
        const balance = await indexer.Balance.get(`${CHAIN}-${V}-${A}`);
        expect(balance?.balance).toBe(6n);
    });
});
