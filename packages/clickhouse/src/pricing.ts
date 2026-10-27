import { type Databases, qualified } from './sql.ts';
import { CONTRACT_PRODUCT, FLAGGED_ROWS, STAMP_QUEUE, USER_TIMELINE } from './timeline.ts';

/**
 * `user_timeline_priced`: the rows of `user_timeline` with the share price of their product at the event time. It is the
 * only table the API reads. Written by the stamping views below, never by the indexer, so a reindex costs nothing here.
 */
export const USER_TIMELINE_PRICED = 'user_timeline_priced';

/** The databarn price table: one row per product per 15 minutes, `share_to_usd` is the USD price of one whole share. */
export const PRODUCT_SHARE_PRICE = 'int_product_share_price';

/** Longest distance to a price that is still trusted (`MAX_PRICE_GAP`). Beyond it the value is flagged or zero. */
export const MAX_PRICE_GAP_SECONDS = 6 * 3600;
/** An event younger than this with no later price yet is `PROVISIONAL`: the next price is still expected. */
export const PROVISIONAL_SECONDS = 3600;
/** Rows inserted within this window are (re)stamped on every refresh; older rows are frozen unless flagged. */
export const RESTAMP_WINDOW_HOURS = 3;
/** Flagged rows younger than this are retried by the repair view. */
export const REPAIR_WINDOW_DAYS = 7;

export const PRICE_FLAGS = ['OK', 'PROVISIONAL', 'EXTRAPOLATED', 'STALE', 'MISSING'] as const;
export type PriceFlag = (typeof PRICE_FLAGS)[number];

export const userTimelinePricedTable = (db: Databases): string => `
CREATE TABLE IF NOT EXISTS ${qualified(db.analytics, USER_TIMELINE_PRICED)}
(
    account String,
    chain_id UInt32,
    timestamp DateTime64(3, 'UTC'),
    block_number UInt64,
    log_index UInt32,
    trx_hash String,
    kind Enum8('BALANCE' = 1, 'CLM_DEPOSIT' = 2, 'CLM_WITHDRAW' = 3, 'CLAIM' = 4, 'MINT' = 5, 'BURN' = 6),
    contract String,
    source LowCardinality(String),
    delta Int256,
    shares_after UInt256,
    amount0 UInt256,
    amount1 UInt256,
    reward_token String,
    reward_amount UInt256,
    event_id String,
    -- the product (vault or CLM manager) the shares belong to, and its share token decimals
    product_address String,
    -- VAULT or CLM_MANAGER (of the product), and VAULT, CLM_MANAGER, BOOST or REWARD_POOL (of this row's contract)
    product_kind LowCardinality(String),
    contract_kind LowCardinality(String),
    decimals UInt8,
    -- USD per whole share at the event time, interpolated between the surrounding 15 minute prices
    share_to_usd Float64,
    price_flag Enum8('OK' = 1, 'PROVISIONAL' = 2, 'EXTRAPOLATED' = 3, 'STALE' = 4, 'MISSING' = 5),
    price_source String,
    -- the prices used: the last at or before the event and the first at or after it (NULL when there is none)
    price_before_at Nullable(DateTime('UTC')),
    price_after_at Nullable(DateTime('UTC')),
    usd_delta Float64,
    usd_after Float64,
    version UInt64,
    is_deleted UInt8
)
-- is_deleted is a plain column on purpose: FINAL would hide a tombstone, and the stamping must see it to cancel the priced row
ENGINE = ReplacingMergeTree(version)
-- no partitioning: a month partition would split one account's rows over a granule per month. Small granules, because a
-- typical account has tens of rows and the read should touch about one granule, not 8192 rows.
ORDER BY (account, timestamp, chain_id, log_index, kind, contract, event_id)
SETTINGS index_granularity = 512
`;

/** What a test or a dev environment uses in place of the databarn table; the same definition. */
export const productSharePriceStub = (db: Databases): string => `
CREATE TABLE IF NOT EXISTS ${qualified(db.prices, PRODUCT_SHARE_PRICE)}
(
    chain_id Int64,
    product_address String,
    beefy_key String,
    date_time DateTime('UTC'),
    share_to_usd Decimal(76, 20),
    price_source String,
    __rmt_version UInt64
)
ENGINE = ReplacingMergeTree(__rmt_version)
PARTITION BY toYYYYMM(date_time)
ORDER BY (chain_id, product_address, date_time)
`;

/** Resource limits applied to every stamping query, as query-level SETTINGS so they travel with the view. */
const STAMP_SETTINGS = `
SETTINGS join_use_nulls = 1, max_threads = 2, max_execution_time = 8, max_memory_usage = 2000000000,
    max_rows_to_read = 50000000, max_bytes_to_read = 20000000000`;

/** The catch-up command is run by an operator on a bounded range: more room, still capped. */
const CATCH_UP_SETTINGS = `
SETTINGS join_use_nulls = 1, max_threads = 4, max_execution_time = 600, max_memory_usage = 8000000000,
    max_rows_to_read = 2000000000`;

const ROW_COLUMNS = [
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
    'is_deleted',
    'product_address',
    'product_kind',
    'contract_kind',
    'decimals',
    'ts',
];

/**
 * The stamping query for the timeline rows matching `where` (an expression over `user_timeline` columns, aliased `t`).
 * It returns only the rows that are new or whose price, flag or tombstone changed, so a refresh that finds nothing
 * new writes nothing.
 *
 * Price at time `t` is the linear interpolation between the last price at or before `t` and the first at or after it
 * (two ASOF joins); see docs/serving-architecture.md for the flags.
 */
export const stampSelect = (db: Databases, where: string, settings: string = STAMP_SETTINGS): string => {
    const timeline = qualified(db.analytics, USER_TIMELINE);
    const priced = qualified(db.analytics, USER_TIMELINE_PRICED);
    const prices = qualified(db.prices, PRODUCT_SHARE_PRICE);
    const product = qualified(db.analytics, CONTRACT_PRODUCT);
    const gap = MAX_PRICE_GAP_SECONDS;

    return `
WITH window_rows AS
(
    SELECT t.*, ifNull(cp.product_address, '') AS product_address, ifNull(cp.product_kind, '') AS product_kind,
        ifNull(cp.kind, '') AS contract_kind, toUInt8(ifNull(cp.decimals, 18)) AS decimals,
        toDateTime(t.timestamp, 'UTC') AS ts, toInt64(t.chain_id) AS chain64
    FROM ${timeline} AS t FINAL
    LEFT JOIN ${product} AS cp ON cp.chain_id = t.chain_id AND cp.contract = t.contract
    WHERE ${where}
),
price_slice AS
(
    SELECT chain_id, product_address, date_time, share_to_usd, price_source
    FROM ${prices} FINAL
    WHERE (toUInt32(chain_id), product_address) IN (SELECT chain_id, product_address FROM window_rows)
        AND date_time >= (SELECT min(ts) FROM window_rows) - ${gap} AND date_time <= (SELECT max(ts) FROM window_rows) + ${gap}
),
stamped AS
(
    SELECT ${ROW_COLUMNS.map((column) => `r.${column} AS ${column}`).join(', ')}, b.date_time AS before_at, f.date_time AS after_at, b.price_source AS before_source, f.price_source AS after_source,
        toFloat64(b.share_to_usd) AS before_price, toFloat64(f.share_to_usd) AS after_price
    FROM window_rows AS r
    ASOF LEFT JOIN price_slice AS b ON r.chain64 = b.chain_id AND r.product_address = b.product_address AND r.ts >= b.date_time
    ASOF LEFT JOIN price_slice AS f ON r.chain64 = f.chain_id AND r.product_address = f.product_address AND r.ts <= f.date_time
),
shaped AS
(
    SELECT *,
        multiIf(
            before_at IS NOT NULL AND after_at IS NOT NULL, 'INTERP',
            before_at IS NOT NULL, if(ts - before_at > ${gap}, 'MISSING', if(now() - ts < ${PROVISIONAL_SECONDS}, 'PROVISIONAL', 'EXTRAPOLATED')),
            after_at IS NOT NULL, if(after_at - ts > ${gap}, 'MISSING', 'EXTRAPOLATED'),
            'MISSING') AS shape
    FROM stamped
),
priced_rows AS
(
    SELECT *,
        multiIf(shape = 'INTERP', if(after_at - before_at > ${gap}, 'STALE', 'OK'), shape) AS flag,
        multiIf(
            shape = 'MISSING', 0.,
            shape = 'INTERP', if(after_at = before_at, before_price, before_price + (after_price - before_price) * (ts - before_at) / (after_at - before_at)),
            before_at IS NULL, after_price,
            before_price) AS price,
        multiIf(shape = 'MISSING', '', before_at IS NOT NULL, ifNull(before_source, ''), ifNull(after_source, '')) AS pricing_source
    FROM shaped
)
SELECT n.account AS account, n.chain_id AS chain_id, n.timestamp AS timestamp, n.block_number AS block_number,
    n.log_index AS log_index, n.trx_hash AS trx_hash, n.kind AS kind, n.contract AS contract, n.source AS source,
    n.delta AS delta, n.shares_after AS shares_after, n.amount0 AS amount0, n.amount1 AS amount1,
    n.reward_token AS reward_token, n.reward_amount AS reward_amount, n.event_id AS event_id,
    n.product_address AS product_address, n.product_kind AS product_kind, n.contract_kind AS contract_kind, n.decimals AS decimals,
    n.price AS share_to_usd, n.flag AS price_flag, n.pricing_source AS price_source,
    n.before_at AS price_before_at, n.after_at AS price_after_at,
    if(n.kind = 'BALANCE', toFloat64(n.delta) / pow(10, n.decimals) * n.price, 0.) AS usd_delta,
    if(n.kind = 'BALANCE', toFloat64(n.shares_after) / pow(10, n.decimals) * n.price, 0.) AS usd_after,
    toUInt64(toUnixTimestamp64Milli(now64(3))) AS version,
    n.is_deleted AS is_deleted
FROM priced_rows AS n
LEFT JOIN
(
    SELECT account, event_id, share_to_usd, price_flag, is_deleted
    FROM ${priced} FINAL
    WHERE (account, event_id) IN (SELECT account, event_id FROM window_rows)
) AS e ON e.account = n.account AND e.event_id = n.event_id
WHERE e.event_id IS NULL OR e.is_deleted != n.is_deleted OR toString(e.price_flag) != n.flag
    OR abs(e.share_to_usd - n.price) > 1e-9 * greatest(abs(n.price), 1.)
${settings}`;
};

const COLUMNS = `account, chain_id, timestamp, block_number, log_index, trx_hash, kind, contract, source, delta, shares_after,
 amount0, amount1, reward_token, reward_amount, event_id, product_address, product_kind, contract_kind, decimals, share_to_usd, price_flag, price_source,
 price_before_at, price_after_at, usd_delta, usd_after, version, is_deleted`;

const stampWhere = {
    /** Rows inserted recently: new rows and the rows whose price can still move. */
    recent: (db: Databases): string =>
        `(t.account, t.event_id) IN (SELECT account, event_id FROM ${qualified(db.analytics, STAMP_QUEUE)} WHERE inserted_at >= now() - INTERVAL ${RESTAMP_WINDOW_HOURS} HOUR)`,
};

/**
 * The stamping view: refreshable, runs inside ClickHouse (so it survives deploys and worker outages), never overlaps
 * itself, and appends only rows that changed. Created stopped by the caller during a backfill (`SYSTEM STOP VIEW`).
 */
export const stampView = (db: Databases): string => `
CREATE MATERIALIZED VIEW IF NOT EXISTS ${qualified(db.analytics, 'mv_stamp_recent')}
REFRESH EVERY 10 SECOND APPEND
TO ${qualified(db.analytics, USER_TIMELINE_PRICED)}
AS ${stampSelect(db, stampWhere.recent(db))}`;

/** Re-stamps rows that are older than the window but still flagged (a late price, a series that arrived). */
export const repairView = (db: Databases): string => `
CREATE MATERIALIZED VIEW IF NOT EXISTS ${qualified(db.analytics, 'mv_stamp_repair')}
REFRESH EVERY 10 MINUTE APPEND
TO ${qualified(db.analytics, USER_TIMELINE_PRICED)}
AS ${stampSelect(
    db,
    `(t.account, t.event_id) IN (SELECT account, event_id FROM ${qualified(db.analytics, FLAGGED_ROWS)}
        WHERE timestamp >= now() - INTERVAL ${REPAIR_WINDOW_DAYS} DAY)`
)}`;

/**
 * Catch-up: the same stamping over an explicit time range of event timestamps, for a backfill after a reindex, a long
 * outage, or when a price series arrives late. Run in chunks (a day or a week) so each statement stays within limits.
 */
export const stampRangeStatement = (db: Databases, from: string, to: string): string => {
    const literal = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;
    if (!literal.test(from) || !literal.test(to)) {
        throw new Error(`stamp range must be 'YYYY-MM-DD[ HH:MM:SS]' UTC, got ${from} .. ${to}`);
    }
    return `
INSERT INTO ${qualified(db.analytics, USER_TIMELINE_PRICED)} (${COLUMNS})
${stampSelect(
    db,
    `t.timestamp >= toDateTime64('${from}', 3, 'UTC') AND t.timestamp < toDateTime64('${to}', 3, 'UTC')`,
    CATCH_UP_SETTINGS
)}`;
};
