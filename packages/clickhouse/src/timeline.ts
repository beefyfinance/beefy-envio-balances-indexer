import * as R from 'remeda';

import { committedFrontier, eventColumns, productFactsCtes, timelineEventsCtes } from './events.ts';
import { type PriceColumn, type PriceFlag, priceColumns, priceFlags, storedPriceResolution } from './pricing.ts';
import {
    type Schema,
    type Sql,
    definerClause,
    ident,
    int,
    join,
    literal,
    qualified,
    sql,
    versionNumber,
} from './sql.ts';

/** The API view's columns, in order: the event, then its price. */
export const timelineColumns = (): string[] => [...eventColumns(), ...priceColumns()];

/**
 * The flags the API view returns: a stored row's ({@link priceFlags}), `PROVISIONAL` for the indexer's price, and
 * `PENDING` for an event with neither (USD values 0) until the next advance gives it a provisional row.
 */
export type TimelinePriceFlag = PriceFlag | 'PENDING';
export const timelinePriceFlags = (): TimelinePriceFlag[] => [...priceFlags(), 'PENDING'];

/** `price_source` and `price_resolution` of a row priced by the indexer (the Beefy API's latest price). */
const INDEXER_PRICE_SOURCE = 'indexer';
const INDEXER_PRICE_RESOLUTION = 'latest';
export const indexerPriceSource = (): string => INDEXER_PRICE_SOURCE;
export type TimelinePriceResolution = ReturnType<typeof storedPriceResolution> | typeof INDEXER_PRICE_RESOLUTION;
/** The `price_resolution` values the API view returns besides '' (MISSING or PENDING). */
export const timelinePriceResolutions = (): TimelinePriceResolution[] => [
    storedPriceResolution(),
    INDEXER_PRICE_RESOLUTION,
];

/** The tables of version N, in our stable database. Dropping a version is dropping these. */
export const eventPriceTable = (version: number): string => `event_price_${versionNumber(version)}`;
export const priceWatermarkTable = (version: number): string => `price_watermark_${versionNumber(version)}`;
export const versionTables = (version: number): string[] => [eventPriceTable(version), priceWatermarkTable(version)];

/** The version a table of ours belongs to (`event_price_<N>`, `price_watermark_<N>`), undefined for any other table. */
export const versionOfTable = (name: string): number | undefined => {
    const match = /^(?:event_price|price_watermark)_([1-9]\d{0,6})$/.exec(name);
    return match?.[1] === undefined ? undefined : Number(match[1]);
};

/**
 * `event_price_<N>`: the stored price of events, written by the reprice job (never by the indexer): every event older
 * than the watermark (final, whatever its flag), and the events above it the indexer did not price (provisional,
 * replaced by the final row when the watermark passes them). Keyed by the event; a reprice writes the rows again with a
 * higher `version`, and `FINAL` keeps the latest. `facts_complete` says whether `decimals` rests on the product facts
 * rather than on a fallback: with a flag other than `OK` or `STALE`, such a row is not final and is retried for a week.
 * A row whose event no longer exists in Envio (a rollback deep enough to cross the watermark) is never shown: the read
 * starts from Envio's events and only looks prices up.
 *
 * Partitioned by month so a reprice writes and rereads only the months it prices; small granules, because an account
 * has tens of rows per month and the read should touch about one granule per partition.
 */
export const eventPriceTableStatement = (schema: Pick<Schema, 'database'>, version: number): Sql => sql`
CREATE TABLE IF NOT EXISTS ${qualified(schema.database, eventPriceTable(version))}
(
    account String,
    chain_id UInt32,
    event_id String,
    timestamp DateTime64(3, 'UTC'),
    -- the product (vault or CLM manager) the shares belong to, its kind and this row's contract kind, and the decimals
    -- the share price counts shares in, as they were when the row was priced
    product_address String,
    product_kind LowCardinality(String),
    contract_kind LowCardinality(String),
    decimals UInt8,
    -- USD per whole share at the event time
    share_to_usd Float64,
    price_flag Enum8('OK' = 1, 'PROVISIONAL' = 2, 'EXTRAPOLATED' = 3, 'STALE' = 4, 'MISSING' = 5),
    price_source LowCardinality(String),
    -- 5m; empty when MISSING
    price_resolution LowCardinality(String),
    -- the prices used: the last at or before the event and the first at or after it (NULL when there is none)
    price_before_at Nullable(DateTime('UTC')),
    price_after_at Nullable(DateTime('UTC')),
    usd_delta Float64,
    usd_after Float64,
    facts_complete UInt8,
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (account, timestamp, event_id)
SETTINGS index_granularity = 256`;

/**
 * `price_watermark_<N>`: one logical row (the latest `moved_at` wins under `FINAL`). Events older than `watermark` have
 * their final price in `event_price_<N>`; newer ones have the indexer's price or a provisional stored row.
 * `checkpoints` is the Envio frontier per chain the stored rows were read at: a row committed later with an old
 * timestamp (a chain Envio is still catching up on, a zap update) is above it, and the next advance stores it.
 */
export const priceWatermarkTableStatement = (schema: Pick<Schema, 'database'>, version: number): Sql => sql`
CREATE TABLE IF NOT EXISTS ${qualified(schema.database, priceWatermarkTable(version))}
(
    watermark DateTime64(3, 'UTC'),
    checkpoints Map(Int32, UInt64),
    moved_at DateTime64(6, 'UTC') DEFAULT now64(6)
)
ENGINE = ReplacingMergeTree(moved_at)
ORDER BY tuple()`;

/** What the API views name: the active version and its Envio database. */
export type ActiveVersion = { version: number; envioDatabase: string };

/** The API's views, in our stable database, recreated by a switch. */
const API_VIEWS = ['user_timeline_api', 'product_contracts_api', 'api_status'] as const;
export type ApiViewName = (typeof API_VIEWS)[number];
export const apiViewNames = (): ApiViewName[] => [...API_VIEWS];
export const userTimelineApi = (): ApiViewName => 'user_timeline_api';
export const productContractsApi = (): ApiViewName => 'product_contracts_api';
export const apiStatusView = (): ApiViewName => 'api_status';

/**
 * The price columns of the view: the stored row's (`s.found = 1`), else the indexer's (`e.head_price` set), else none;
 * the product facts of a row not stored come from the event's head_* columns ('' and 18 decimals when unknown).
 */
const priceSelect = (): Sql => {
    const indexer = sql`e.head_price IS NOT NULL`;
    const usd = (amount: 'delta' | 'shares_after'): Sql =>
        sql`multiIf(s.found = 1, s.${ident(amount === 'delta' ? 'usd_delta' : 'usd_after')}, ${indexer},
            if(e.kind = 'BALANCE', ifNull(toFloat64(e.${ident(amount)}) / pow(10, ifNull(e.head_decimals, 18)) * e.head_price, 0.), 0.), 0.)`;
    const columns: Record<PriceColumn, Sql> = {
        // no product facts are read: without a stored row, the facts the indexer wrote on the event (priced or not)
        product_address: sql`if(s.found = 1, s.product_address, ifNull(e.head_product, ''))`,
        product_kind: sql`if(s.found = 1, s.product_kind, ifNull(e.head_product_kind, ''))`,
        contract_kind: sql`if(s.found = 1, s.contract_kind, ifNull(e.head_contract_kind, ''))`,
        decimals: sql`if(s.found = 1, s.decimals, ifNull(e.head_decimals, toUInt8(18)))`,
        share_to_usd: sql`multiIf(s.found = 1, s.share_to_usd, ${indexer}, ifNull(e.head_price, 0.), 0.)`,
        price_flag: sql`multiIf(s.found = 1, s.price_flag, ${indexer}, 'PROVISIONAL', 'PENDING')`,
        price_source: sql`multiIf(s.found = 1, s.price_source, ${indexer}, ${literal(INDEXER_PRICE_SOURCE)}, '')`,
        price_resolution: sql`multiIf(s.found = 1, s.price_resolution, ${indexer}, ${literal(INDEXER_PRICE_RESOLUTION)}, '')`,
        price_before_at: sql`multiIf(s.found = 1, s.price_before_at, ${indexer}, e.head_price_at, NULL)`,
        price_after_at: sql`if(s.found = 1, s.price_after_at, NULL)`,
        usd_delta: usd('delta'),
        usd_after: usd('shares_after'),
    };
    return join(
        R.map(priceColumns(), (column) => sql`${columns[column]} AS ${ident(column)}`),
        sql`,\n    `
    );
};

/**
 * `user_timeline_api(account)`: the API's only timeline query, `SELECT ... FROM user_timeline_api(account = {...})`.
 * One row per event of the account ({@link timelineColumns}), unordered. Events come from the active version's Envio
 * database ({@link timelineEventsCtes}); each takes its price from:
 * 1. its `event_price_<N>` row if it has one, final or provisional (the timestamp is part of the match, so a row stored
 *    for an event that a rollback replayed at another time is not used);
 * 2. else the indexer's price (`PROVISIONAL`, `price_source = 'indexer'`, `price_resolution = 'latest'`, `price_before_at`
 *    when the indexer fetched it); USD values for `BALANCE` rows, as the reprice job computes them;
 * 3. else nothing: `PENDING`, USD values 0.
 *
 * No price table and no product facts are read: a lookup only, so the planning stays small. Each source is one CTE,
 * referenced once (ClickHouse inlines a CTE at every reference, and plans it again each time).
 *
 * Runs as the definer when one is configured, so the API user needs no grant on what it reads. Heavy accounts are
 * stopped by the API user's settings profile (rows, bytes, time).
 */
export const userTimelineApiView = (
    schema: Schema,
    active: ActiveVersion,
    name: string = userTimelineApi()
): Sql => sql`
CREATE VIEW ${qualified(schema.database, name)}${definerClause(schema)} AS
WITH
${timelineEventsCtes(active.envioDatabase, 'events', {
    where: sql`account = {account:String}`,
    frontier: committedFrontier(active.envioDatabase),
})},
stored AS
(
    -- an unmatched event gets found = 0 (the column's default), without join_use_nulls: the API user may set nothing
    SELECT event_id, timestamp, toUInt8(1) AS found, product_address, toString(product_kind) AS product_kind,
        toString(contract_kind) AS contract_kind, decimals, share_to_usd, toString(price_flag) AS price_flag,
        toString(price_source) AS price_source, toString(price_resolution) AS price_resolution, price_before_at,
        price_after_at, usd_delta, usd_after
    FROM ${qualified(schema.database, eventPriceTable(active.version))} FINAL
    WHERE account = {account:String}
)
SELECT ${join(R.map(eventColumns(), (column) => sql`e.${ident(column)} AS ${ident(column)}`))},
    ${priceSelect()}
FROM events AS e
LEFT JOIN stored AS s ON s.event_id = e.event_id AND s.timestamp = e.timestamp`;

/** Every contract of a Beefy product (vaults, managers, boosts, reward pools): their "timelines" are not a user's. */
export const productContractsApiView = (
    schema: Schema,
    active: ActiveVersion,
    name: string = productContractsApi()
): Sql => sql`
CREATE VIEW ${qualified(schema.database, name)}${definerClause(schema)} AS
WITH
${productFactsCtes(active.envioDatabase, 'facts')}
SELECT DISTINCT contract FROM facts`;

/**
 * One row: the active version (for the API's cache keys, so a switch does not serve timelines of the old one), its
 * watermark and how old it is. Both are NULL before the version's first advance: there is no watermark yet (nothing is
 * stored), which is not the same as a watermark stuck at the epoch. The version is a checked integer
 * ({@link versionNumber}): a view's definition cannot take a query parameter (it would become a view parameter).
 */
export const apiStatusViewStatement = (
    schema: Schema,
    active: ActiveVersion,
    name: string = apiStatusView()
): Sql => sql`
CREATE VIEW ${qualified(schema.database, name)}${definerClause(schema)} AS
WITH
latest AS
(
    SELECT if(count() = 0, NULL, toNullable(max(watermark))) AS watermark
    FROM ${qualified(schema.database, priceWatermarkTable(active.version))} FINAL
)
SELECT toUInt32(${int(versionNumber(active.version))}) AS version, watermark,
    dateDiff('second', watermark, now64(3)) AS watermark_age_seconds
FROM latest`;

/** The API views and how to create each under a given name (a switch creates them aside, then swaps them in). */
export const apiViews = (
    schema: Schema,
    active: ActiveVersion
): { name: ApiViewName; create: (name: string) => Sql }[] => [
    { name: userTimelineApi(), create: (name) => userTimelineApiView(schema, active, name) },
    { name: productContractsApi(), create: (name) => productContractsApiView(schema, active, name) },
    { name: apiStatusView(), create: (name) => apiStatusViewStatement(schema, active, name) },
];

/** What the API selects from `api_status` (one row: `version`, `watermark_at` as a string or NULL, `watermark_age_seconds`). */
export const apiStatusSelect = (database: string): Sql =>
    sql`SELECT version, toString(watermark) AS watermark_at, watermark_age_seconds FROM ${qualified(database, apiStatusView())}`;

/** What the API selects from `product_contracts_api`. */
export const productContractsSelect = (database: string): Sql =>
    sql`SELECT contract FROM ${qualified(database, productContractsApi())}`;

/** Validates a database name for use in a statement (Envio's are given by an operator) and returns it as it is. */
export const databaseName = (name: string): string => {
    ident(name);
    return name;
};
