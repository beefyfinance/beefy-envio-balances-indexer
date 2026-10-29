import type { TimelinePriceFlag, TimelinePriceResolution } from '@beefy/clickhouse';
import { chainById } from '@beefy/models';

import { formatUnits } from './units.ts';

/** One row of `user_timeline_api`, as the repository returns it (64 bit integers arrive as strings). */
export type PricedRow = {
    chain_id: number;
    timestamp_ms: string;
    block_number: string;
    log_index: number;
    trx_hash: string;
    kind: 'BALANCE' | 'CLM_DEPOSIT' | 'CLM_WITHDRAW' | 'CLAIM' | 'MINT' | 'BURN';
    contract: string;
    source: string;
    delta: string;
    shares_after: string;
    amount0: string;
    amount1: string;
    reward_token: string;
    reward_amount: string;
    product_address: string;
    product_kind: string;
    contract_kind: string;
    decimals: number;
    share_to_usd: number;
    price_flag: TimelinePriceFlag;
    /** The price source of the 5 minute table, `indexer` for the indexer's latest Beefy API price, '' when MISSING or PENDING. */
    price_source: string;
    /** Which price table the price came from, `latest` for the indexer's price; empty when MISSING or PENDING. */
    price_resolution: TimelinePriceResolution | '';
    price_before_at: number | null;
    price_after_at: number | null;
    usd_delta: number;
    usd_after: number;
};

export type TimelineItem = {
    type: 'classic' | 'clm';
    datetime: string;
    timestamp: number;
    block_number: number;
    transaction_hash: string;
    chain: string;
    chain_id: number;
    product_address: string;
    actions: string[];
    share_balance: string;
    share_diff: string;
    contracts: { address: string; kind: string; balance: string; diff: string }[];
    price: {
        share_to_usd: number;
        flag: TimelinePriceFlag;
        source: string;
        /** 5m: the 5 minute price table; latest: the indexer's price; null when MISSING or PENDING. */
        resolution: TimelinePriceResolution | null;
        as_of: string | null;
        as_of_next: string | null;
    };
    usd_balance: number;
    usd_diff: number;
    /** CLM deposits and withdrawals: the underlying token amounts, signed, in the smallest unit of token0 and token1. */
    underlying?: { amount0: string; amount1: string };
    /** Reward claims: smallest unit of the reward token; `usd` waits for the token price table. */
    claims: { contract: string; token: string | null; amount: string; usd: number | null }[];
};

const iso = (seconds: number | null): string | null =>
    seconds === null ? null : new Date(seconds * 1000).toISOString();

type Group = {
    rows: PricedRow[];
    balanceAfter: bigint;
};

const actionsOf = (rows: readonly PricedRow[]): string[] => {
    const actions: string[] = [];
    for (const row of rows) {
        if (row.kind === 'CLM_DEPOSIT' || row.kind === 'MINT') actions.push('deposit');
        else if (row.kind === 'CLM_WITHDRAW' || row.kind === 'BURN') actions.push('withdraw');
        else if (row.kind === 'CLAIM') actions.push('claim');
        else {
            const delta = BigInt(row.delta);
            if (delta === 0n) continue;
            if (row.source === 'BOOST_STAKE') actions.push(delta > 0n ? 'stake' : 'unstake');
            else actions.push(delta > 0n ? 'transfer_in' : 'transfer_out');
        }
    }
    const unique = [...new Set(actions)];
    // the mint or burn of shares belongs to the deposit or withdrawal that caused it, and the move between a vault and
    // a boost to the stake or unstake: neither is a transfer
    return unique.filter(
        (action) =>
            !(action === 'transfer_in' && (unique.includes('deposit') || unique.includes('unstake'))) &&
            !(action === 'transfer_out' && (unique.includes('withdraw') || unique.includes('stake')))
    );
};

/**
 * Turns one account's priced rows (oldest first) into the response items, newest first: one item per transaction and
 * product. A product's balance is the running sum of the share changes of all its contracts (vault, boosts, reward
 * pools), so moving shares between them nets to zero.
 */
export const buildTimeline = (rows: readonly PricedRow[]): TimelineItem[] => {
    const groups = new Map<string, Group>();
    const balances = new Map<string, bigint>();

    for (const row of rows) {
        const product = `${row.chain_id}:${row.product_address === '' ? row.contract : row.product_address}`;
        const key = `${product}:${row.trx_hash}`;
        let group = groups.get(key);
        if (group === undefined) {
            group = { rows: [], balanceAfter: balances.get(product) ?? 0n };
            groups.set(key, group);
        }
        group.rows.push(row);
        if (row.kind === 'BALANCE') balances.set(product, (balances.get(product) ?? 0n) + BigInt(row.delta));
        group.balanceAfter = balances.get(product) ?? 0n;
    }

    const items: TimelineItem[] = [];
    for (const { rows: groupRows, balanceAfter } of groups.values()) {
        const last = groupRows[groupRows.length - 1];
        if (last === undefined) continue;
        const priced = [...groupRows].reverse().find((row) => row.kind === 'BALANCE') ?? last;
        const balanceRows = groupRows.filter((row) => row.kind === 'BALANCE');
        const decimals = last.decimals;
        const chain = chainById(last.chain_id)?.key ?? String(last.chain_id);
        const timestamp = Math.floor(Number(last.timestamp_ms) / 1000);

        const contracts = new Map<string, { kind: string; diff: bigint; balance: bigint }>();
        for (const row of balanceRows) {
            const entry = contracts.get(row.contract) ?? { kind: row.contract_kind, diff: 0n, balance: 0n };
            entry.diff += BigInt(row.delta);
            entry.balance = BigInt(row.shares_after);
            contracts.set(row.contract, entry);
        }
        const diff = balanceRows.reduce((sum, row) => sum + BigInt(row.delta), 0n);

        const clmRows = groupRows.filter((row) => row.kind === 'CLM_DEPOSIT' || row.kind === 'CLM_WITHDRAW');
        const underlying =
            clmRows.length === 0
                ? undefined
                : clmRows.reduce(
                      (sum, row) => {
                          const sign = row.kind === 'CLM_DEPOSIT' ? 1n : -1n;
                          return {
                              amount0: sum.amount0 + sign * BigInt(row.amount0),
                              amount1: sum.amount1 + sign * BigInt(row.amount1),
                          };
                      },
                      { amount0: 0n, amount1: 0n }
                  );

        items.push({
            type: last.product_kind === 'CLM_MANAGER' ? 'clm' : 'classic',
            datetime: new Date(timestamp * 1000).toISOString(),
            timestamp,
            block_number: Number(last.block_number),
            transaction_hash: last.trx_hash,
            chain,
            chain_id: last.chain_id,
            product_address: last.product_address === '' ? last.contract : last.product_address,
            actions: actionsOf(groupRows),
            share_balance: formatUnits(balanceAfter, decimals),
            share_diff: formatUnits(diff, decimals),
            contracts: [...contracts].map(([address, entry]) => ({
                address,
                kind: entry.kind,
                balance: formatUnits(entry.balance, decimals),
                diff: formatUnits(entry.diff, decimals),
            })),
            price: {
                share_to_usd: priced.share_to_usd,
                flag: priced.price_flag,
                source: priced.price_source,
                resolution: priced.price_resolution === '' ? null : priced.price_resolution,
                as_of: iso(priced.price_before_at),
                as_of_next: iso(priced.price_after_at),
            },
            usd_balance: (Number(balanceAfter) / 10 ** decimals) * priced.share_to_usd,
            usd_diff: balanceRows.reduce((sum, row) => sum + row.usd_delta, 0),
            ...(underlying === undefined
                ? {}
                : { underlying: { amount0: underlying.amount0.toString(), amount1: underlying.amount1.toString() } }),
            claims: groupRows
                .filter((row) => row.kind === 'CLAIM')
                .map((row) => ({
                    contract: row.contract,
                    token: row.reward_token === '' ? null : row.reward_token,
                    amount: row.reward_amount,
                    usd: null,
                })),
        });
    }
    return items.reverse();
};
