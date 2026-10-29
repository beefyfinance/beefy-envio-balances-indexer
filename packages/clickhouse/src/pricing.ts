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
/** Every flag a stored row's column accepts (`PROVISIONAL` is the API view's, for the indexer's price). */
export const priceFlags = (): PriceFlag[] => [...PRICE_FLAGS];

/** A price further than this from the event is not used at all: the window each side is looked up in. */
const REACH_SECONDS = 48 * 3600;
/** Two prices further apart than this give a `STALE` interpolation. */
const STALE_SECONDS = 6 * 3600;
/** Days of prices around an event's day that may hold its prices (the reach, rounded up to whole days). */
const REACH_DAYS = Math.ceil(REACH_SECONDS / 86_400);

/**
 * The largest gap between two prices that still gives an `OK` interpolation: the watermark stays this far behind the
 * freshest prices, so an event it passes can have a price after it.
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
 * (never to its want's).
 */
export const priceStubs = (prices: PriceTables): Sql[] => [
    sql`CREATE TABLE IF NOT EXISTS ${qualifiedName(prices.token)}
(chain_id Int64, representation_address String, decimals Int64, asset_id Nullable(UInt64))
ENGINE = MergeTree ORDER BY (chain_id, representation_address)`,
    sql`CREATE TABLE IF NOT EXISTS ${qualifiedName(prices.price5m)}
(asset_id UInt64, date_time DateTime('UTC'), price Decimal(76, 20), price_source String)
ENGINE = MergeTree PARTITION BY toYYYYMM(date_time) ORDER BY (asset_id, date_time)`,
];

/**
 * CTEs (to follow other CTEs in a `WITH`) that price the events of CTE `input`, which has {@link eventColumns} plus
 * `chain` (the Int32 chain id). The result is CTE `px_priced`: the event columns then {@link priceColumns}, one row per
 * event, plus `facts_complete` (see {@link productFactsCtes}; 0 for an unknown contract), stored with the row so the
 * retry window knows which rows are not final yet. Every CTE is referenced once, except `px_days` (twice, in the same
 * scalar subquery, which ClickHouse runs once).
 *
 * - **Product**: Envio's `Contract`, `ContractLink` and `Token`, read live ({@link productFactsCtes}), all of them: a few
 *   thousand rows. An unknown contract keeps its row, priced `MISSING`.
 * - **Asset**: the product's share token through the token table; a vault is never priced from its want. Should the
 *   table map a token to several assets, the smallest id wins, so the pick does not change from one query to the next.
 * - **Price**: linear interpolation between the last 5 minute price at or before the event and the first at or after
 *   it, each used only within 48 hours of the event, so the result depends on the event alone and not on which other
 *   events are priced with it. Where two rows share a time, the larger `price_source` wins, again so the result is
 *   deterministic.
 *
 * Flags: `OK` (both sides, at most 6 hours apart), `STALE` (both sides, further apart), `EXTRAPOLATED` (one side only,
 * carried flat), `MISSING` (none: the value is 0, `price_resolution` empty).
 *
 * The price table is filtered by the events' assets and days on its own key columns (`asset_id`, the day of
 * `date_time`), so partitions and granules are pruned; one ASOF join finds both prices (each price point carries the
 * next one, and each series starts with a sentinel row whose next point is its first). Every column a join may leave
 * unmatched is Nullable on its right side or carries a `found` flag, so the SQL needs no `join_use_nulls` setting.
 */
export const pricedEventsCtes = (prices: PriceTables, envioDatabase: string, input: string): Sql => {
    const columns = (alias: string, list: readonly EventColumn[]): Sql =>
        join(R.map(list, (column) => sql`${ident(alias)}.${ident(column)} AS ${ident(column)}`));
    // one scalar subquery for both sets: ClickHouse runs a scalar subquery once per query, so px_rows is computed once
    // for them, not once per set
    const sets = sql`(SELECT (groupUniqArray(asset_id), groupUniqArray(day)) FROM px_days)`;
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
        toDateTime(e.timestamp, 'UTC') AS ts, a.token_asset AS asset_id
    FROM ${ident(input)} AS e
    LEFT JOIN px_facts AS p ON p.chain_id = e.chain AND p.contract = e.contract
    LEFT JOIN px_assets AS a ON a.chain = e.chain AND a.address = p.product_address
),
px_days AS
(
    SELECT DISTINCT asset_id, toDate(ts) + offset AS day
    FROM px_rows
    ARRAY JOIN range(${int(-REACH_DAYS)}, ${int(REACH_DAYS + 1)}) AS offset
    WHERE asset_id != 0
),
px_points AS
(
    -- two sets rather than one of pairs: a tuple IN uses one key column only, these use both. The day is computed on
    -- date_time itself (a monotonic function of a key column), which still prunes partitions and granules
    -- aliases named apart from the columns: ClickHouse would substitute them inside the aggregates
    SELECT asset_id, date_time, argMax(toFloat64(price), price_source) AS point_price, max(price_source) AS point_source
    FROM ${qualifiedName(prices.price5m)}
    WHERE asset_id IN (SELECT arrayJoin(tupleElement(${sets}, 1)))
        AND toDate(date_time) IN (SELECT arrayJoin(tupleElement(${sets}, 2)))
    GROUP BY asset_id, date_time
),
px_series AS
(
    -- the next point of each point
    SELECT asset_id, date_time, point_price, point_source,
        leadInFrame(toNullable(date_time)) OVER following AS following_at,
        leadInFrame(toNullable(point_price)) OVER following AS following_price,
        leadInFrame(toNullable(point_source)) OVER following AS following_source,
        row_number() OVER series AS n
    FROM px_points
    WINDOW series AS (PARTITION BY asset_id ORDER BY date_time),
        following AS (PARTITION BY asset_id ORDER BY date_time ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING)
),
px_slice AS
(
    SELECT asset_id,
        if(sentinel = 1, toDateTime(0, 'UTC'), date_time) AS key_at,
        if(sentinel = 1, NULL, toNullable(date_time)) AS at,
        if(sentinel = 1, NULL, toNullable(point_price)) AS price,
        if(sentinel = 1, NULL, toNullable(point_source)) AS source,
        if(sentinel = 1, toNullable(date_time), following_at) AS next_at,
        if(sentinel = 1, toNullable(point_price), following_price) AS next_price,
        if(sentinel = 1, toNullable(point_source), following_source) AS next_source
    FROM px_series
    ARRAY JOIN if(n = 1, [1, 0], [0]) AS sentinel
),
px_matched AS
(
    -- the last price at or before the event and the first at or after it, each only if within reach
    SELECT ${columns('r', eventColumns())}, r.product_address AS product_address, r.product_kind AS product_kind,
        r.contract_kind AS contract_kind, toUInt8(r.decimals) AS decimals, r.facts_complete AS facts_complete, r.ts AS ts,
        if(r.ts - s.at <= ${int(REACH_SECONDS)}, s.at, NULL) AS before_at,
        if(if(s.at = r.ts, s.at, s.next_at) - r.ts <= ${int(REACH_SECONDS)}, if(s.at = r.ts, s.at, s.next_at), NULL) AS after_at,
        s.price AS before_price, if(s.at = r.ts, s.price, s.next_price) AS after_price,
        s.source AS before_source, if(s.at = r.ts, s.source, s.next_source) AS after_source
    FROM px_rows AS r
    ASOF LEFT JOIN px_slice AS s ON r.asset_id = s.asset_id AND r.ts >= s.key_at
),
px_flagged AS
(
    SELECT *,
        multiIf(
            before_at IS NOT NULL AND after_at IS NOT NULL, if(after_at - before_at > ${int(STALE_SECONDS)}, 'STALE', 'OK'),
            before_at IS NOT NULL OR after_at IS NOT NULL, 'EXTRAPOLATED',
            'MISSING') AS price_flag,
        toFloat64(ifNull(multiIf(
            before_at IS NOT NULL AND after_at IS NOT NULL, if(after_at = before_at, before_price,
                before_price + (after_price - before_price) * (ts - before_at) / (after_at - before_at)),
            before_at IS NOT NULL, before_price,
            after_at IS NOT NULL, after_price,
            0.), 0.)) AS share_to_usd
    FROM px_matched
),
px_priced AS
(
    SELECT ${join(R.map(eventColumns(), ident))}, product_address, product_kind, contract_kind, decimals, facts_complete, share_to_usd,
        price_flag,
        multiIf(before_at IS NOT NULL, ifNull(before_source, ''), after_at IS NOT NULL, ifNull(after_source, ''), '') AS price_source,
        if(price_flag = 'MISSING', '', ${literal(STORED_PRICE_RESOLUTION)}) AS price_resolution,
        toNullable(toDateTime(before_at, 'UTC')) AS price_before_at,
        toNullable(toDateTime(after_at, 'UTC')) AS price_after_at,
        if(kind = 'BALANCE', toFloat64(delta) / pow(10, decimals) * share_to_usd, 0.) AS usd_delta,
        if(kind = 'BALANCE', toFloat64(shares_after) / pow(10, decimals) * share_to_usd, 0.) AS usd_after
    FROM px_flagged
)`;
};
