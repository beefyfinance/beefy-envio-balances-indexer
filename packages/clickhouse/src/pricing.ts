import * as R from 'remeda';

import { type EventColumn, eventColumns, productFactsCtes } from './events.ts';
import { type PriceTables, type Sql, ident, int, join, literal, qualifiedName, sql } from './sql.ts';

/**
 * Prices of a timeline event: the share price of its product at the event time, from the 5 minute price table. Only
 * the reprice job runs it ({@link pricedEventsCtes}, rows stored in `event_price_<N>`, final below the watermark and
 * provisional above it): the API view only looks prices up.
 */

const PRICE_FLAGS = ['OK', 'PROVISIONAL', 'EXTRAPOLATED', 'STALE', 'MISSING'] as const;
export type PriceFlag = (typeof PRICE_FLAGS)[number];
/**
 * Every flag a stored row's column accepts (`PROVISIONAL` is the API view's, for the indexer's price; `EXTRAPOLATED` only
 * on rows stored by the older pricing).
 */
export const priceFlags = (): PriceFlag[] => [...PRICE_FLAGS];

/** A carried slot is `OK` when the actual price it carries is at most this old, else `STALE`. */
const STALE_SECONDS = 6 * 3600;

/**
 * The watermark stays this far behind the freshest actual price, so an event it passes has its slot written and a
 * late price of that slot has had time to arrive.
 */
export const maxPriceGapSeconds = (): number => STALE_SECONDS;

/** The only `price_resolution` of a stored row with a price (MISSING rows have ''). */
const STORED_PRICE_RESOLUTION = '5m';
export const storedPriceResolution = (): typeof STORED_PRICE_RESOLUTION => STORED_PRICE_RESOLUTION;

const PRICE_COLUMNS = [
    'product_address',
    'product_kind',
    'contract_kind',
    'decimals',
    'share_to_usd',
    'price_flag',
    'price_source',
    'price_resolution',
    'price_before_at',
    'price_after_at',
    'usd_delta',
    'usd_after',
] as const;
export type PriceColumn = (typeof PRICE_COLUMNS)[number];

/** What the pricing adds to an event: the view's columns after the event's, and `event_price`'s. */
export const priceColumns = (): PriceColumn[] => [...PRICE_COLUMNS];

/**
 * The flags of a final price: a stored row with another flag (or with incomplete product facts) is retried by the
 * advances of the next days (the retry window), so a late price or fact still fixes it.
 */
export const finalPriceFlags = (): PriceFlag[] => ['OK', 'STALE'];

/**
 * What a test or a dev environment uses in place of the databarn tables: the columns the pricing reads, the same sort
 * keys. A token maps to at most one asset; a classic vault's or a CLM's share token maps to the asset of its share price
 * (never to its want's). A price row is a 5 minute slot: `is_carried` 0 for an actual price, 1 for the last one carried
 * forward (databarn writes one row per asset per slot while its carry rules allow); `observed_at` is the slot of the
 * value it holds or carries.
 */
export const priceStubs = (prices: PriceTables): Sql[] => [
    sql`CREATE TABLE IF NOT EXISTS ${qualifiedName(prices.token)}
(chain_id Int64, representation_address String, decimals Int64, asset_id Nullable(UInt64))
ENGINE = MergeTree ORDER BY (chain_id, representation_address)`,
    sql`CREATE TABLE IF NOT EXISTS ${qualifiedName(prices.price5m)}
(asset_id UInt64, date_time DateTime('UTC'), price Float64, price_source LowCardinality(String), is_carried UInt8,
    observed_at DateTime('UTC'))
ENGINE = MergeTree PARTITION BY toYYYYMM(date_time) ORDER BY (asset_id, date_time)`,
];

/**
 * CTEs (to follow other CTEs in a `WITH`) that price the events of CTE `input`, which has {@link eventColumns} plus
 * `chain` (the Int32 chain id). The result is CTE `px_priced`: the event columns then {@link priceColumns}, one row per
 * event, plus `facts_complete` (see {@link productFactsCtes}; 0 for an unknown contract), stored with the row so the
 * retry window knows which rows are not final yet. Every CTE is referenced once, except `px_rows` (twice) and `px_keys`
 * (in one scalar subquery, written three times, which ClickHouse runs once).
 *
 * - **Product**: Envio's `Contract`, `ContractLink` and `Token`, read live ({@link productFactsCtes}), all of them: a few
 *   thousand rows. An unknown contract keeps its row, priced `MISSING`.
 * - **Asset**: the product's share token through the token table; a vault is never priced from its want. Should the
 *   table map a token to several assets, the smallest id wins, so the pick does not change from one query to the next.
 * - **Price**: the row of the event's 5 minute slot, as databarn resolved it (its source priorities and carry rules:
 *   an oracle price for a day, a vault's last share rate at any age times its want's price of the slot). No
 *   interpolation: a step in the price (a CLM rebalance, a vault's first share rate) is never smeared over the events
 *   around it. Should two rows share a slot, an actual price wins over a carried one, then the larger `price_source`.
 * - **Age**: the row's `observed_at`, the slot of the actual price it holds or carries (`price_before_at`).
 *
 * Flags: `OK` (an actual price in the slot, or one carried from at most 6 hours before), `STALE` (carried from
 * further back), `MISSING` (no row for the slot: the value is 0, `price_resolution` empty). `EXTRAPOLATED` is not
 * produced any more; rows stored by the older pricing may still hold it.
 *
 * The price table is read once, by its key columns (`asset_id`, the day of `date_time`), so partitions and granules are
 * pruned, and only the events' slots are kept; they are matched by key, never by an ASOF join (which would hold its
 * whole right side in memory). The slot match carries a `found` flag, so the SQL needs no `join_use_nulls` setting.
 */
export const pricedEventsCtes = (prices: PriceTables, envioDatabase: string, input: string): Sql => {
    const columns = (alias: string, list: readonly EventColumn[]): Sql =>
        join(R.map(list, (column) => sql`${ident(alias)}.${ident(column)} AS ${ident(column)}`));
    // one scalar subquery for every set: ClickHouse runs a scalar subquery once per query, so px_keys is computed once
    // for them, not once per use. Sets rather than pairs alone: a tuple IN may use one key column only, these use both
    const keys = sql`(SELECT (groupUniqArray(asset_id), groupUniqArray(toDate(slot)), groupUniqArray((asset_id, slot))) FROM px_keys)`;
    const onKeys = sql`asset_id IN (SELECT arrayJoin(tupleElement(${keys}, 1)))
        AND toDate(date_time) IN (SELECT arrayJoin(tupleElement(${keys}, 2)))`;
    return sql`
${productFactsCtes(envioDatabase, 'px_facts')},
px_assets AS
(
    SELECT toInt32(chain_id) AS chain, representation_address AS address, min(assumeNotNull(asset_id)) AS token_asset
    FROM ${qualifiedName(prices.token)}
    WHERE asset_id IS NOT NULL
    GROUP BY chain, address
),
px_rows AS
(
    SELECT ${columns('e', eventColumns())}, e.chain AS chain,
        p.product_address AS product_address, p.product_kind AS product_kind, p.contract_kind AS contract_kind,
        if(p.found = 1, p.decimals, toUInt8(18)) AS decimals, p.facts_complete AS facts_complete,
        toStartOfFiveMinutes(toDateTime(e.timestamp, 'UTC')) AS slot, a.token_asset AS asset_id
    FROM ${ident(input)} AS e
    LEFT JOIN px_facts AS p ON p.chain_id = e.chain AND p.contract = e.contract
    LEFT JOIN px_assets AS a ON a.chain = e.chain AND a.address = p.product_address
),
px_keys AS
(
    SELECT DISTINCT asset_id, slot FROM px_rows WHERE asset_id != 0
),
px_slots AS
(
    -- aliases named apart from the columns: ClickHouse would substitute them inside the aggregates
    SELECT asset_id, date_time AS slot_at, argMax(price, (is_carried = 0, price_source)) AS slot_price,
        argMax(price_source, (is_carried = 0, price_source)) AS slot_source,
        argMax(observed_at, (is_carried = 0, price_source)) AS slot_observed_at, toUInt8(1) AS found
    FROM ${qualifiedName(prices.price5m)}
    WHERE ${onKeys}
        AND (asset_id, date_time) IN (SELECT arrayJoin(tupleElement(${keys}, 3)))
    GROUP BY asset_id, date_time
),
px_matched AS
(
    SELECT ${columns('r', eventColumns())}, r.product_address AS product_address, r.product_kind AS product_kind,
        r.contract_kind AS contract_kind, toUInt8(r.decimals) AS decimals, r.facts_complete AS facts_complete, r.slot AS slot,
        s.found AS found, s.slot_price AS slot_price, s.slot_source AS slot_source, s.slot_observed_at AS observed_at
    FROM px_rows AS r
    LEFT JOIN px_slots AS s ON s.asset_id = r.asset_id AND s.slot_at = r.slot
),
px_priced AS
(
    SELECT ${join(R.map(eventColumns(), ident))}, product_address, product_kind, contract_kind, decimals, facts_complete,
        if(found = 1, slot_price, 0.) AS share_to_usd,
        multiIf(found = 0, 'MISSING', slot - observed_at <= ${int(STALE_SECONDS)}, 'OK', 'STALE') AS price_flag,
        if(found = 1, toString(slot_source), '') AS price_source,
        if(found = 1, ${literal(STORED_PRICE_RESOLUTION)}, '') AS price_resolution,
        if(found = 1, toNullable(toDateTime(observed_at, 'UTC')), NULL) AS price_before_at,
        CAST(NULL AS Nullable(DateTime('UTC'))) AS price_after_at,
        if(kind = 'BALANCE', toFloat64(delta) / pow(10, decimals) * share_to_usd, 0.) AS usd_delta,
        if(kind = 'BALANCE', toFloat64(shares_after) / pow(10, decimals) * share_to_usd, 0.) AS usd_after
    FROM px_matched
)`;
};
