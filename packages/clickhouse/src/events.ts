import * as R from 'remeda';

import { type Param, type Sql, ident, param, qualified, sql } from './sql.ts';

/**
 * The timeline is not copied: the indexer writes it as one Envio entity, `TimelineEvent`, sorted by account, and every
 * read goes to Envio's history table `envio_history_TimelineEvent` in the version's Envio database. Only `BALANCE` rows
 * move a share balance; `MINT` and `BURN` mark a balance change as a deposit or a withdrawal, the CLM rows carry the
 * underlying amounts, `CLAIM` the reward paid.
 *
 * Contract with the indexer, which every read below relies on:
 * - an id never changes `account` (the read filters by account before it keeps the latest row per id, so a row moved
 *   to another account would stay visible to the first one);
 * - a `TimelineEvent` is never deleted by a handler. Envio writes a deleted entity as a `DELETE` history row whose data
 *   columns are all empty (`account = ''`, no timestamp), so neither the account filter of the API view nor the time
 *   range of the reprice job would ever see it: the event would stay visible. A rollback is not a problem: Envio
 *   deletes the rolled back history rows physically, it writes no `DELETE` row for them.
 */
export const timelineEventHistoryTable = (): string => 'envio_history_TimelineEvent';
export const envioChainsTable = (): string => 'envio_chains';

const EVENT_COLUMNS = [
    'account',
    'chain_id',
    'timestamp',
    'block_number',
    'log_index',
    'trx_hash',
    'kind',
    'contract',
    'source',
    'delta',
    'shares_after',
    'amount0',
    'amount1',
    'reward_token',
    'reward_amount',
    'event_id',
] as const;
export type EventColumn = (typeof EVENT_COLUMNS)[number];

/** What {@link timelineEventsCtes} returns per event, in this order (plus `chain`, the chain id as Envio's Int32). */
export const eventColumns = (): EventColumn[] => [...EVENT_COLUMNS];

const HEAD_COLUMNS = [
    'head_price',
    'head_price_at',
    'head_product',
    'head_decimals',
    'head_product_kind',
    'head_contract_kind',
] as const;

/**
 * The indexer's price of an event, on `TimelineEvent` (`headPrice`, `headPriceAt`, `headProduct`, `headDecimals`): the
 * latest Beefy API share price it had when it wrote a recent event and when it fetched it (both NULL when it did not
 * price the event: indexed during a sync, no fresh API price), and the price facts of the event's contract as the
 * indexer knew them (product, decimals, product and contract kinds, as {@link productFactsCtes}): set whenever the
 * facts were known, priced or not. Versions indexed before these columns existed cannot be served by the API view.
 */
export const headColumns = (): string[] => [...HEAD_COLUMNS];

/**
 * Envio's committed checkpoint per chain, read when the query runs (what Envio's own entity views use): rows above it
 * belong to a batch that may still be rolled back. A scalar expression, evaluated once per query.
 */
export const committedFrontier = (envioDatabase: string): Sql =>
    sql`(SELECT mapFromArrays(groupArray(toInt32(chain_id)), groupArray(toUInt64(checkpoint_id))) FROM ${qualified(envioDatabase, envioChainsTable())} FINAL)`;

/** A frontier captured earlier (a job pins one for all its statements), as a query parameter. */
export const frontierParam = (frontier: Readonly<Record<string, string>>): Param =>
    param('Map(Int32, UInt64)', frontierValue(frontier));

/** A frontier (chain id to checkpoint, as read back from ClickHouse) as the value of a {@link frontierParam}. */
export const frontierValue = (frontier: Readonly<Record<string, string>>): Map<number, bigint> =>
    new Map(
        R.pipe(
            frontier,
            R.entries(),
            R.map(([chain, checkpoint]): [number, bigint] => {
                if (!/^-?\d{1,10}$/.test(chain) || !/^\d{1,20}$/.test(checkpoint)) {
                    throw new Error(`invalid frontier entry ${JSON.stringify(chain)}: ${JSON.stringify(checkpoint)}`);
                }
                return [Number(chain), BigInt(checkpoint)];
            })
        )
    );

export type EventsFilter = {
    /** An expression over the history table's columns, applied before the deduplication. */
    where: Sql;
    /** The frontier expression: {@link committedFrontier} or a {@link frontierParam}. */
    frontier: Sql | Param;
    /** A filter applied after the deduplication, on the output columns (the latest row's). */
    latest?: Sql;
};

/**
 * CTEs `<name>_history` then `<name>`: the events matching `where`, as Envio's entity view would show them: history
 * rows at or below the committed `frontier` of their chain, the latest row per id, and only if that row is a `SET`. A
 * rolled back batch is physically deleted by Envio. Unlike Envio's view, `where` is applied before the deduplication,
 * so a filter on `account` reads the sort key's range instead of the whole table; this is why a `DELETE` row (data
 * columns empty) is never seen here, and why handlers never delete a `TimelineEvent` (see above). The `SET` filter
 * stays as a guard.
 *
 * Amounts are decimal strings in Envio's table; the `OrZero` variants keep one malformed value from failing a read.
 *
 * Besides {@link eventColumns} and `chain`, each event carries the indexer's price ({@link headColumns}), NULL when the
 * indexer did not price it. `latest` is a filter on these output columns (the indexer's price of an event is the one of
 * its latest row, so a filter on it must not run before the deduplication).
 */
export const timelineEventsCtes = (
    envioDatabase: string,
    name: string,
    { where, frontier, latest }: EventsFilter
): Sql => {
    const history = ident(`${name}_history`);
    return sql`
${history} AS
(
    WITH ${frontier} AS envio_frontier
    SELECT *
    FROM ${qualified(envioDatabase, timelineEventHistoryTable())}
    WHERE (${where}) AND envio_checkpoint_id <= envio_frontier[chain_id]
    ORDER BY id ASC, chain_id ASC, envio_checkpoint_id DESC
    LIMIT 1 BY id, chain_id
),
${ident(name)} AS
(
    SELECT account, toUInt32(chain_id) AS chain_id, toInt32(chain_id) AS chain, block_timestamp AS timestamp,
        toUInt64(block_number) AS block_number, toUInt32(log_index) AS log_index, trx_hash, kind, lower(contract) AS contract,
        toString(source) AS source, toInt256OrZero(delta) AS delta, toUInt256OrZero(shares_after) AS shares_after,
        toUInt256OrZero(amount0) AS amount0, toUInt256OrZero(amount1) AS amount1, lower(reward_token) AS reward_token,
        toUInt256OrZero(reward_amount) AS reward_amount, id AS event_id,
        toFloat64(head_price) AS head_price, toDateTime(head_price_at, 'UTC') AS head_price_at,
        lower(head_product) AS head_product, toUInt8(head_decimals) AS head_decimals,
        toString(head_product_kind) AS head_product_kind, toString(head_contract_kind) AS head_contract_kind
    FROM ${history}
    WHERE envio_change = 'SET'${latest === undefined ? sql`` : sql` AND (${latest})`}
)`;
};

/**
 * CTEs ending in `<name>`: which product (vault or CLM manager) a contract's shares belong to, one row per contract
 * (`chain_id`, `contract`, `product_address`, `contract_kind`, `product_kind`, `decimals`, `facts_complete`, and
 * `found` = 1 for a LEFT JOIN to tell a match): itself for
 * vaults and managers, the staked token for boosts and reward pools. `contract_kind` is the kind of the contract,
 * `product_kind` of the product (`VAULT`, `CLM_MANAGER`, or `UNKNOWN` while the indexer has not read it). Read live from
 * Envio's entity tables. Each CTE is referenced once (ClickHouse inlines a CTE at every reference).
 *
 * `decimals` is the unit the share price is quoted in, which is not always the share token's own: a classic vault's
 * price counts shares in its want token's decimals (a USDC vault's `decimals()` says 18, but its price is per 10^6
 * share units; checked against the API on every Arbitrum vault), a CLM's in its share token's. A vault whose want or
 * want decimals the indexer has not read falls back to the share token's decimals, and a token without decimals to 18.
 * Read when the query runs, so a want link that lands late shows up at once.
 *
 * `facts_complete` (0 or 1) says whether `decimals` rests on facts rather than on a fallback: a `VAULT` product needs
 * its `VAULT_WANT` link and the want token's decimals, any other known product kind its share token's decimals; a
 * product whose kind is not read yet is incomplete (and a contract that is no product at all has no row here). It is
 * stored with each priced row, so the retry window prices again the rows whose facts were incomplete.
 *
 * Deterministic: when the indexer has several candidates (two `VAULT_WANT` links, a contract that is both a product and
 * a link source), the pick does not depend on the order ClickHouse reads them in: a product's own row first, then the
 * latest link by `since_block`, ties broken by address.
 */
export const productFactsCtes = (envioDatabase: string, name: string): Sql => {
    const cte = (suffix: string) => ident(`${name}${suffix}`);
    const contract = qualified(envioDatabase, 'Contract');
    const link = qualified(envioDatabase, 'ContractLink');
    const token = qualified(envioDatabase, 'Token');
    // unmatched LEFT JOIN columns take their type's default (no join_use_nulls: the API user may set nothing), so each
    // joined CTE carries found = 1
    return sql`
${cte('_mapping')} AS
(
    SELECT toInt32(chain_id) AS chain_id, lower(address) AS contract, lower(address) AS product_address,
        toString(kind) AS kind, toUInt8(0) AS priority, toUInt64(0) AS since
    FROM ${contract}
    WHERE kind IN ('VAULT', 'CLM_MANAGER')
    UNION ALL
    SELECT toInt32(chain_id) AS chain_id, lower(from_address) AS contract, lower(to_address) AS product_address,
        if(relation = 'BOOST_STAKED', 'BOOST', 'REWARD_POOL') AS kind, toUInt8(1) AS priority, toUInt64(since_block) AS since
    FROM ${link}
    WHERE relation IN ('BOOST_STAKED', 'REWARD_POOL_STAKED')
),
${cte('_products')} AS
(
    SELECT toInt32(chain_id) AS chain_id, lower(address) AS address, toString(kind) AS product_kind, toUInt8(1) AS found
    FROM ${contract}
),
${cte('_share_tokens')} AS
(
    SELECT toInt32(chain_id) AS chain_id, lower(address) AS address, toInt64(ifNull(decimals, 18)) AS decimals,
        toUInt8(decimals IS NOT NULL) AS found
    FROM ${token}
),
${cte('_wants')} AS
(
    -- the latest want link, the larger address on a tie
    SELECT toInt32(chain_id) AS chain_id, lower(from_address) AS vault,
        argMax(lower(to_address), (toUInt64(since_block), lower(to_address))) AS want, toUInt8(1) AS found
    FROM ${link}
    WHERE relation = 'VAULT_WANT'
    GROUP BY chain_id, vault
),
${cte('_want_tokens')} AS
(
    SELECT toInt32(chain_id) AS chain_id, lower(address) AS address, toInt64(ifNull(decimals, 18)) AS decimals,
        toUInt8(decimals IS NOT NULL) AS found
    FROM ${token}
),
${cte('')} AS
(
    SELECT m.chain_id AS chain_id, m.contract AS contract, m.product_address AS product_address, m.kind AS contract_kind,
        if(p.found = 1, p.product_kind, 'UNKNOWN') AS product_kind,
        toUInt8(multiIf(
            p.found = 1 AND p.product_kind = 'VAULT' AND wt.found = 1, wt.decimals,
            t.found = 1, t.decimals,
            18)) AS decimals,
        toUInt8(multiIf(
            p.found = 0 OR p.product_kind = 'UNKNOWN', 0,
            p.product_kind = 'VAULT', w.found = 1 AND wt.found = 1,
            t.found = 1)) AS facts_complete,
        toUInt8(1) AS found
    FROM ${cte('_mapping')} AS m
    LEFT JOIN ${cte('_products')} AS p ON p.chain_id = m.chain_id AND p.address = m.product_address
    LEFT JOIN ${cte('_share_tokens')} AS t ON t.chain_id = m.chain_id AND t.address = m.product_address
    LEFT JOIN ${cte('_wants')} AS w ON w.chain_id = m.chain_id AND w.vault = m.product_address
    LEFT JOIN ${cte('_want_tokens')} AS wt ON wt.chain_id = m.chain_id AND wt.address = w.want
    ORDER BY chain_id, contract, m.priority, m.since DESC, product_address
    LIMIT 1 BY chain_id, contract
)`;
};
