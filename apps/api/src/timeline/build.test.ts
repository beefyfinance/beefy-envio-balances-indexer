import { describe, expect, it } from 'vitest';

import { buildTimeline, type PricedRow } from './build.ts';

const E18 = 10n ** 18n;
const VAULT = '0xvault';
const BOOST = '0xboost';
const MANAGER = '0xmanager';

let log = 0;
const row = (overrides: Partial<PricedRow> & { at: string; trx: string }): PricedRow => {
    const { at, trx, ...rest } = overrides;
    log += 1;
    return {
        chain_id: 8453,
        timestamp_ms: String(Date.parse(at)),
        block_number: '100',
        log_index: log,
        trx_hash: trx,
        kind: 'BALANCE',
        contract: VAULT,
        source: 'TRANSFER',
        delta: '0',
        shares_after: '0',
        amount0: '0',
        amount1: '0',
        reward_token: '',
        reward_amount: '0',
        product_address: VAULT,
        product_kind: 'VAULT',
        contract_kind: 'VAULT',
        decimals: 18,
        share_to_usd: 2,
        price_flag: 'OK',
        price_source: 'test',
        price_resolution: '5m',
        price_before_at: Date.parse(at) / 1000,
        price_after_at: null,
        usd_delta: 0,
        usd_after: 0,
        ...rest,
    };
};

describe('buildTimeline', () => {
    it('returns the newest transaction first with a running balance and the value at that time', () => {
        const items = buildTimeline([
            row({
                at: '2026-01-01T10:00:00Z',
                trx: '0x1',
                delta: String(5n * E18),
                shares_after: String(5n * E18),
                usd_delta: 10,
            }),
            row({
                at: '2026-01-02T10:00:00Z',
                trx: '0x2',
                delta: String(-2n * E18),
                shares_after: String(3n * E18),
                usd_delta: -4,
                share_to_usd: 3,
            }),
        ]);
        expect(items.map((item) => item.transaction_hash)).toEqual(['0x2', '0x1']);
        expect(items[0]).toMatchObject({
            type: 'classic',
            chain: 'base',
            datetime: '2026-01-02T10:00:00.000Z',
            actions: ['transfer_out'],
            share_balance: '3',
            share_diff: '-2',
            usd_balance: 9,
            usd_diff: -4,
        });
        expect(items[1]).toMatchObject({
            share_balance: '5',
            share_diff: '5',
            usd_balance: 10,
            actions: ['transfer_in'],
        });
    });

    it('nets a stake against the vault, so the product balance does not move', () => {
        const [item] = buildTimeline([
            row({ at: '2026-01-01T10:00:00Z', trx: '0x1', delta: String(5n * E18), shares_after: String(5n * E18) }),
            row({ at: '2026-01-02T10:00:00Z', trx: '0x2', delta: String(-5n * E18), shares_after: '0' }),
            row({
                at: '2026-01-02T10:00:00Z',
                trx: '0x2',
                contract: BOOST,
                contract_kind: 'BOOST',
                source: 'BOOST_STAKE',
                delta: String(5n * E18),
                shares_after: String(5n * E18),
            }),
        ]);
        expect(item).toMatchObject({ actions: ['stake'], share_balance: '5', share_diff: '0' });
        expect(item?.contracts).toEqual([
            { address: VAULT, kind: 'VAULT', balance: '0', diff: '-5' },
            { address: BOOST, kind: 'BOOST', balance: '5', diff: '5' },
        ]);
    });

    it('reports a CLM deposit as one deposit with the underlying amounts, not as a transfer too', () => {
        const [item] = buildTimeline([
            row({
                at: '2026-01-01T10:00:00Z',
                trx: '0x1',
                contract: MANAGER,
                product_address: MANAGER,
                product_kind: 'CLM_MANAGER',
                contract_kind: 'CLM_MANAGER',
                delta: String(7n * E18),
                shares_after: String(7n * E18),
            }),
            row({
                at: '2026-01-01T10:00:00Z',
                trx: '0x1',
                kind: 'CLM_DEPOSIT',
                contract: MANAGER,
                product_address: MANAGER,
                product_kind: 'CLM_MANAGER',
                contract_kind: 'CLM_MANAGER',
                amount0: '1000',
                amount1: '2000',
            }),
        ]);
        expect(item).toMatchObject({
            type: 'clm',
            actions: ['deposit'],
            share_balance: '7',
            underlying: { amount0: '1000', amount1: '2000' },
        });
    });

    it('reports a mint as a deposit and a burn as a withdrawal, whatever the vault type', () => {
        const [withdraw, deposit] = buildTimeline([
            row({ at: '2026-01-01T10:00:00Z', trx: '0x1', delta: String(5n * E18), shares_after: String(5n * E18) }),
            row({ at: '2026-01-01T10:00:00Z', trx: '0x1', kind: 'MINT' }),
            row({ at: '2026-01-02T10:00:00Z', trx: '0x2', delta: String(-5n * E18), shares_after: '0' }),
            row({ at: '2026-01-02T10:00:00Z', trx: '0x2', kind: 'BURN' }),
        ]);
        expect(deposit).toMatchObject({ actions: ['deposit'], share_balance: '5', share_diff: '5' });
        expect(withdraw).toMatchObject({ actions: ['withdraw'], share_balance: '0', share_diff: '-5' });
    });

    it('signs withdrawals and lists claims without inventing a USD value', () => {
        const [claim, withdraw] = buildTimeline([
            row({ at: '2026-01-01T10:00:00Z', trx: '0x1', kind: 'CLM_WITHDRAW', amount0: '10', amount1: '20' }),
            row({
                at: '2026-01-02T10:00:00Z',
                trx: '0x2',
                kind: 'CLAIM',
                contract: '0xpool',
                reward_token: '0xreward',
                reward_amount: '42',
            }),
        ]);
        expect(withdraw?.underlying).toEqual({ amount0: '-10', amount1: '-20' });
        expect(withdraw?.actions).toEqual(['withdraw']);
        expect(claim).toMatchObject({
            actions: ['claim'],
            share_diff: '0',
            claims: [{ contract: '0xpool', token: '0xreward', amount: '42', usd: null }],
        });
    });

    it('splits one transaction into one item per product and exposes the price flags and timestamps', () => {
        const other = '0xother';
        const items = buildTimeline([
            row({
                at: '2026-01-01T10:00:00Z',
                trx: '0x1',
                delta: String(E18),
                shares_after: String(E18),
                price_flag: 'PROVISIONAL',
            }),
            row({
                at: '2026-01-01T10:00:00Z',
                trx: '0x1',
                contract: other,
                product_address: other,
                delta: String(E18),
                shares_after: String(E18),
                price_after_at: Date.parse('2026-01-01T10:15:00Z') / 1000,
                price_flag: 'MISSING',
                price_source: '',
                price_resolution: '',
            }),
        ]);
        expect(items).toHaveLength(2);
        expect(items.map((item) => item.product_address).sort()).toEqual([other, VAULT]);
        expect(items.find((item) => item.product_address === VAULT)?.price).toMatchObject({
            flag: 'PROVISIONAL',
            resolution: '5m',
            as_of_next: null,
        });
        expect(items.find((item) => item.product_address === other)?.price).toMatchObject({
            flag: 'MISSING',
            resolution: null,
            as_of_next: '2026-01-01T10:15:00.000Z',
        });
    });

    it('passes the indexer price and PENDING through', () => {
        const unstored = { product_kind: 'CLM_MANAGER', contract_kind: 'CLM_MANAGER', price_after_at: null } as const;
        const [pending, indexer] = buildTimeline([
            row({
                ...unstored,
                at: '2026-01-01T10:00:00Z',
                trx: '0x1',
                contract: MANAGER,
                product_address: MANAGER,
                kind: 'CLM_DEPOSIT',
                amount0: '5',
                amount1: '7',
                price_source: 'indexer',
                price_resolution: 'latest',
                price_flag: 'PROVISIONAL',
            }),
            row({
                ...unstored,
                at: '2026-01-01T11:00:00Z',
                trx: '0x2',
                // the indexer did not know the facts yet
                product_address: '',
                product_kind: '',
                contract_kind: '',
                delta: String(E18),
                shares_after: String(E18),
                share_to_usd: 0,
                price_flag: 'PENDING',
                price_source: '',
                price_resolution: '',
                price_before_at: null,
            }),
        ]);
        expect(indexer).toMatchObject({
            type: 'clm',
            product_address: MANAGER,
            price: { flag: 'PROVISIONAL', source: 'indexer', resolution: 'latest', as_of: '2026-01-01T10:00:00.000Z' },
        });
        expect(pending).toMatchObject({
            type: 'classic',
            product_address: VAULT,
            price: { share_to_usd: 0, flag: 'PENDING', source: '', resolution: null, as_of: null },
            usd_balance: 0,
        });
    });

    it('is empty for an account with no rows', () => {
        expect(buildTimeline([])).toEqual([]);
    });
});
