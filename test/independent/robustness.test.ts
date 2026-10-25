/**
 * Blacklists, determinism / idempotence, RPC budget (docs/architecture.md "Allowed eth_calls": O(contracts), never O(events)), and the
 * registry's resistance to foreign events.
 */
import { createTestIndexer } from 'envio';
import { afterAll, describe, expect, it } from 'vitest';
import { latestById, registrationsOf, rowsOf } from '../helpers/simulate';
import { fakeHash, installRpcCounter, transferItem, vaultCreated, vaultInitialized } from './harness';
import {
    BOOST_HISTORY,
    CHAIN,
    CLASSIC_VAULT_FACTORY,
    DEPLOYER,
    type RealTransfer,
    VAULT,
    VAULT_HISTORY,
    ZAP,
} from './realData';

type Row = Record<string, unknown> & { id: string };

const V = VAULT.address;
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dead';
/** blacklisted vault on Base (src/lib/blacklist.ts is the input list, not the expectation) */
const BLACKLISTED_VAULT = '0x0a1bbea11423f0cd2c247a9ad2ae6bd06aebc60d';

const synth = (i: number, from: string, to: string, value: bigint): RealTransfer => ({
    block: 25300000 + i,
    timestamp: 1737389000 + i * 2,
    logIndex: 1,
    hash: fakeHash(10_000 + i),
    txFrom: '0x000000000000000000000000000000000000beef',
    from: from as `0x${string}`,
    to: to as `0x${string}`,
    value,
});

const holder = (i: number) => `0x${(0xa0000 + (i % 7)).toString(16).padStart(40, '0')}`;

/** Real vault V history plus `extra` synthetic transfers among 7 holders (after the real history). */
const vaultScenario = (extra: number) => {
    const transfers = [...VAULT_HISTORY.transfers];
    for (let i = 0; i < extra; i++) {
        transfers.push(
            i % 3 === 0 ? synth(i, ZERO, holder(i), 1000n + BigInt(i)) : synth(i, holder(i - 1), holder(i), 1n)
        );
    }
    return [vaultCreated(), vaultInitialized(), ...transfers.map((t) => transferItem('ClassicVault', V, t))];
};

describe('blacklist', () => {
    it('a blacklisted vault from a factory event is neither registered nor written', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        { ...vaultCreated(), params: { proxy: BLACKLISTED_VAULT } },
                        { ...vaultCreated(false), logIndex: 900, params: { proxy: BLACKLISTED_VAULT } },
                    ],
                },
            },
        });
        expect(registrationsOf(result)).toEqual([]);
        expect(rowsOf(result, 'Contract')).toEqual([]);
    });

    it('raw balances for every holder but 0x0 (zap, 0xdead included); ShareTransfer kept', async () => {
        const t = (logIndex: number, from: string, to: string, value: bigint): RealTransfer => ({
            block: 25059500,
            timestamp: 1736908347,
            logIndex,
            hash: fakeHash(20_000),
            txFrom: DEPLOYER,
            from: from as `0x${string}`,
            to: to as `0x${string}`,
            value,
        });
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        vaultCreated(),
                        vaultInitialized(),
                        transferItem('ClassicVault', V, t(1, ZERO, ZAP, 100n)),
                        transferItem('ClassicVault', V, t(2, ZAP, DEPLOYER, 100n)),
                        transferItem('ClassicVault', V, t(3, DEPLOYER, DEAD, 10n)),
                    ],
                },
            },
        });
        expect(rowsOf(result, 'ShareTransfer')).toHaveLength(3);
        const accounts = rowsOf<Row>(result, 'BalanceChange').map((c) => c.account);
        expect(accounts).toEqual([ZAP, ZAP, DEPLOYER, DEPLOYER, DEAD]);
        const balances = latestById<Row>(result, 'Balance');
        expect([...balances.values()].map((b) => [b.account, b.balance])).toEqual([
            [ZAP, 0n],
            [DEPLOYER, 90n],
            [DEAD, 10n],
        ]);
        // a transfer to 0xdead is not a burn: totalSupply() still counts it
        expect(latestById<Row>(result, 'TokenSupply').get(`${CHAIN}-${V}`)?.totalSupply).toBe(100n);
    });
});

describe('determinism and idempotence', () => {
    it('two fresh indexers on the same input produce identical rows', async () => {
        const run = async () => {
            const indexer = createTestIndexer();
            return indexer.process({ chains: { [CHAIN]: { simulate: vaultScenario(20) } } });
        };
        const [a, b] = [await run(), await run()];
        for (const entity of ['ShareTransfer', 'BalanceChange', 'Balance', 'TokenSupply', 'ContractLink', 'Contract']) {
            expect(rowsOf(b, entity), entity).toEqual(rowsOf(a, entity));
        }
    });

    it('event row ids are unique per event / per (event, account)', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({ chains: { [CHAIN]: { simulate: vaultScenario(30) } } });
        for (const entity of ['ShareTransfer', 'BalanceChange']) {
            const ids = rowsOf<Row>(result, entity).map((r) => r.id);
            expect(new Set(ids).size, entity).toBe(ids.length);
        }
        const st = rowsOf<Row>(result, 'ShareTransfer');
        expect(st).toHaveLength(VAULT_HISTORY.transfers.length + 30);
    });

    it('re-processing an already processed block range does not double count', async () => {
        const indexer = createTestIndexer();
        const items = vaultScenario(5);
        await indexer.process({ chains: { [CHAIN]: { simulate: items } } });
        const before = await indexer.TokenSupply.get(`${CHAIN}-${V}`);
        let rejected = false;
        try {
            await indexer.process({ chains: { [CHAIN]: { simulate: items.slice(2) } } });
        } catch {
            rejected = true; // the test indexer refuses to go back: nothing to double count
        }
        const after = await indexer.TokenSupply.get(`${CHAIN}-${V}`);
        if (!rejected) expect(after?.totalSupply).toBe(before?.totalSupply);
        expect(after?.totalSupply).toBe(before?.totalSupply);
    });
});

describe('RPC budget', () => {
    const counter = installRpcCounter();
    afterAll(() => counter.restore());

    it('vault: RPC requests do not grow with the number of transfers (O(1) per contract)', async () => {
        counter.reset();
        await createTestIndexer().process({ chains: { [CHAIN]: { simulate: vaultScenario(3) } } });
        const few = counter.count;
        counter.reset();
        await createTestIndexer().process({ chains: { [CHAIN]: { simulate: vaultScenario(120) } } });
        const many = counter.count;
        expect(many).toBe(few);
        // vault facts (want / token, one multicall), share metadata, want metadata, proxy classification at most
        expect(many).toBeLessThanOrEqual(4);
        expect(counter.fetches.filter((f) => !f.includes('eth_call'))).toEqual([]);
    });

    it('boost: 46 stakes + rewards cost a constant number of reads', async () => {
        counter.reset();
        await createTestIndexer().process({
            chains: {
                [CHAIN]: {
                    simulate: BOOST_HISTORY.events
                        .filter((e) => e.event === 'Staked' || e.event === 'Withdrawn')
                        .map((e) => ({
                            contract: 'ClassicBoost',
                            event: e.event,
                            srcAddress: BOOST_HISTORY.boost,
                            logIndex: e.logIndex,
                            block: { number: e.block, timestamp: e.timestamp },
                            transaction: { hash: e.hash, from: e.txFrom },
                            params: { user: e.user, amount: e.amount },
                        })) as never,
                },
            },
        });
        // boost facts (one multicall) + staked / reward token metadata + the boost's own Token row metadata
        expect(counter.count).toBeLessThanOrEqual(4);
    });
});

describe('registry robustness', () => {
    it('a foreign ContractDeployed naming a future vault address does not hijack its kind', async () => {
        // Any contract can emit ContractDeployed(bytes32,address) and clone addresses are predictable (CREATE nonce).
        // ContractFactory is address-bound: a foreign emitter is never routed to a handler at all.
        const foreign = createTestIndexer().process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        {
                            contract: 'ContractFactory',
                            event: 'ContractDeployed',
                            srcAddress: '0x00000000000000000000000000000000deadbeef',
                            logIndex: 1,
                            block: { number: 25058900, timestamp: 1736907147 },
                            transaction: { hash: fakeHash(30_000), from: '0x00000000000000000000000000000000000bad00' },
                            params: {
                                contractName: `0x${Buffer.from('spoof').toString('hex').padEnd(64, '0')}`,
                                proxy: V,
                            },
                        },
                    ],
                },
            },
        });
        await expect(foreign).rejects.toThrow(/never reached a handler/);

        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        vaultCreated(),
                        vaultInitialized(),
                        transferItem('ClassicVault', V, VAULT_HISTORY.transfers[0] as RealTransfer),
                    ],
                },
            },
        });
        const contract = latestById<Row>(result, 'Contract').get(`${CHAIN}-${V}`);
        expect(contract?.kind).toBe('VAULT');
        expect(contract?.factory).toBe(CLASSIC_VAULT_FACTORY);
        expect(rowsOf(result, 'ShareTransfer')).toHaveLength(1);
    });
});
