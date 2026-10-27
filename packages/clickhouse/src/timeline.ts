import { type Databases, qualified } from './sql.ts';

/**
 * `user_timeline`: every balance change, CLM deposit and withdrawal, and reward claim, re-keyed by account and unpriced.
 * Envio's tables are ordered by chain and token; this one answers "everything this account did" with one range read.
 *
 * Only `BALANCE` rows move a share balance. The other kinds are markers with a zero `delta`: `MINT` and `BURN` say a
 * balance change was a deposit or a withdrawal (shares created from or destroyed to the zero address, which is what
 * the vault does), and the CLM rows carry the underlying token amounts of those events.
 */
export const USER_TIMELINE = 'user_timeline';

export const userTimelineTable = (db: Databases): string => `
CREATE TABLE IF NOT EXISTS ${qualified(db.analytics, USER_TIMELINE)}
(
    account String,
    chain_id UInt32,
    timestamp DateTime64(3, 'UTC'),
    block_number UInt64,
    log_index UInt32,
    trx_hash String,
    kind Enum8('BALANCE' = 1, 'CLM_DEPOSIT' = 2, 'CLM_WITHDRAW' = 3, 'CLAIM' = 4, 'MINT' = 5, 'BURN' = 6),
    -- the share token (or boost) for BALANCE, MINT and BURN, the CLM manager for CLM_*, the reward pool or boost for CLAIM
    contract String,
    -- BALANCE only: TRANSFER or BOOST_STAKE
    source LowCardinality(String),
    -- BALANCE only: signed share change and the contract's balance after it
    delta Int256,
    shares_after UInt256,
    -- CLM_DEPOSIT, CLM_WITHDRAW: underlying token amounts
    amount0 UInt256,
    amount1 UInt256,
    -- CLAIM only; the token is empty for boosts (resolved through the BOOST_REWARD link when valued)
    reward_token String,
    reward_amount UInt256,
    -- Envio's id of the row this one projects, so a rollback tombstone replaces exactly it
    event_id String,
    inserted_at DateTime64(3, 'UTC') DEFAULT now64(3),
    version UInt64,
    is_deleted UInt8,
    INDEX idx_inserted_at inserted_at TYPE minmax GRANULARITY 1
)
-- is_deleted is a plain column on purpose: FINAL would hide a tombstone, and the stamping must see it to cancel the priced row
-- partitioned by month so the catch-up command can stamp one month and read only that partition; nothing reads this
-- table per account (the API reads user_timeline_priced), so the granule-per-partition cost does not matter here
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (account, timestamp, chain_id, log_index, kind, contract, event_id)
`;

type Projection = {
    /** Also the name of the materialized view, `mv_user_timeline_<name>`. */
    name: string;
    /** The Envio history table it reads, without database. */
    source: string;
    /** The SELECT list: one expression per `user_timeline` column. */
    columns: string;
    /** A filter on the source rows, without the keyword. */
    where?: string;
};

const ZERO = 'toUInt256(0)';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// Amounts are decimal strings in Envio's tables. The OrZero variants keep a malformed value from failing an insert
// into the indexer's own table (a materialized view that throws blocks the source insert); the integrity query in the
// tests compares the totals so a zero cannot hide.
const common = (accountColumn: string): string => `
    lower(${accountColumn}) AS account,
    toUInt32(chain_id) AS chain_id,
    block_timestamp AS timestamp,
    toUInt64(block_number) AS block_number,
    toUInt32(log_index) AS log_index,
    trx_hash,
    id AS event_id,
    envio_checkpoint_id AS version,
    toUInt8(envio_change = 'DELETE') AS is_deleted`;

const projections: Projection[] = [
    {
        name: 'balance',
        source: 'envio_history_BalanceChange',
        columns: `${common('account')},
    'BALANCE' AS kind,
    lower(token) AS contract,
    toString(source) AS source,
    toInt256OrZero(delta) AS delta,
    toUInt256OrZero(balance_after) AS shares_after,
    ${ZERO} AS amount0,
    ${ZERO} AS amount1,
    '' AS reward_token,
    ${ZERO} AS reward_amount`,
    },
    ...[
        { name: 'clm_deposit', source: 'envio_history_ClmDeposit', kind: 'CLM_DEPOSIT' },
        { name: 'clm_withdraw', source: 'envio_history_ClmWithdraw', kind: 'CLM_WITHDRAW' },
    ].map(({ name, source, kind }) => ({
        name,
        source,
        columns: `${common('user')},
    '${kind}' AS kind,
    lower(manager) AS contract,
    '' AS source,
    toInt256(0) AS delta,
    ${ZERO} AS shares_after,
    toUInt256OrZero(amount0) AS amount0,
    toUInt256OrZero(amount1) AS amount1,
    '' AS reward_token,
    ${ZERO} AS reward_amount`,
    })),
    ...[
        { name: 'mint', kind: 'MINT', account: 'to_address', where: `from_address = '${ZERO_ADDRESS}'` },
        { name: 'burn', kind: 'BURN', account: 'from_address', where: `to_address = '${ZERO_ADDRESS}'` },
    ].map(({ name, kind, account, where }) => ({
        name,
        source: 'envio_history_ShareTransfer',
        where,
        columns: `${common(account)},
    '${kind}' AS kind,
    lower(token) AS contract,
    '' AS source,
    toInt256(0) AS delta,
    ${ZERO} AS shares_after,
    ${ZERO} AS amount0,
    ${ZERO} AS amount1,
    '' AS reward_token,
    ${ZERO} AS reward_amount`,
    })),
    {
        name: 'claim',
        source: 'envio_history_RewardPaid',
        columns: `${common('user')},
    'CLAIM' AS kind,
    lower(contract) AS contract,
    '' AS source,
    toInt256(0) AS delta,
    ${ZERO} AS shares_after,
    ${ZERO} AS amount0,
    ${ZERO} AS amount1,
    lower(ifNull(reward_token, '')) AS reward_token,
    toUInt256OrZero(amount) AS reward_amount`,
    },
];

export const projectionNames = projections.map(({ name }) => name);

const viewName = (name: string): string => `mv_user_timeline_${name}`;

const select = (db: Databases, projection: Projection): string => `
SELECT ${projection.columns}
FROM ${qualified(db.raw, projection.source)}${projection.where === undefined ? '' : `\nWHERE ${projection.where}`}`;

/**
 * One insert-time view per raw history table. They only project and re-key columns (no join, no aggregation), so they
 * add about one column projection per inserted row to the indexer's writes. They fire on inserts only: rows that
 * already exist are loaded with {@link backfillStatements}.
 */
export const projectionViews = (db: Databases): string[] =>
    projections.map(
        (projection) => `
CREATE MATERIALIZED VIEW IF NOT EXISTS ${qualified(db.analytics, viewName(projection.name))}
TO ${qualified(db.analytics, USER_TIMELINE)}
AS ${select(db, projection)}`
    );

export const dropProjectionViews = (db: Databases): string[] =>
    projections.map(({ name }) => `DROP VIEW IF EXISTS ${qualified(db.analytics, viewName(name))}`);

/** Loads what the raw tables already hold. Idempotent: the table is a ReplacingMergeTree keyed by the event. */
export const backfillStatements = (db: Databases): string[] =>
    projections.map(
        (projection) => `
INSERT INTO ${qualified(db.analytics, USER_TIMELINE)}
(account, chain_id, timestamp, block_number, log_index, trx_hash, event_id, version, is_deleted, kind, contract, source,
 delta, shares_after, amount0, amount1, reward_token, reward_amount)
${select(db, projection)}`
    );

/**
 * Which product (vault or CLM manager) a contract's shares belong to: itself for vaults and managers, the staked
 * token for boosts and reward pools. `kind` is the kind of the contract, `product_kind` of the product (`VAULT` or
 * `CLM_MANAGER`), `decimals` those of the product's share token. Small, read by the stamping view and the API.
 */
export const CONTRACT_PRODUCT = 'contract_product';

export const contractProductView = (db: Databases): string => `
CREATE OR REPLACE VIEW ${qualified(db.analytics, CONTRACT_PRODUCT)} AS
SELECT m.chain_id AS chain_id, m.contract AS contract, m.product_address AS product_address, m.kind AS kind,
    ifNull(p.product_kind, 'UNKNOWN') AS product_kind, ifNull(t.decimals, 18) AS decimals
FROM
(
    SELECT chain_id, lower(address) AS contract, lower(address) AS product_address, toString(kind) AS kind
    FROM ${qualified(db.raw, 'Contract')}
    WHERE kind IN ('VAULT', 'CLM_MANAGER')
    UNION ALL
    SELECT chain_id, lower(from_address) AS contract, lower(to_address) AS product_address,
        if(relation = 'BOOST_STAKED', 'BOOST', 'REWARD_POOL') AS kind
    FROM ${qualified(db.raw, 'ContractLink')}
    WHERE relation IN ('BOOST_STAKED', 'REWARD_POOL_STAKED')
) AS m
LEFT JOIN
(
    SELECT chain_id, lower(address) AS address, toString(kind) AS product_kind FROM ${qualified(db.raw, 'Contract')}
) AS p ON p.chain_id = m.chain_id AND p.address = m.product_address
LEFT JOIN ${qualified(db.raw, 'Token')} AS t ON t.chain_id = m.chain_id AND lower(t.address) = m.product_address
SETTINGS join_use_nulls = 1`;

/**
 * Small queues that make the stamping cheap, because the main tables are ordered by account and a time window would
 * otherwise scan them:
 * - `stamp_queue`: the key of every row written to `user_timeline` in the last day, filled by a view on that table
 *   (so it covers all four projections and the backfill);
 * - `flagged_rows`: the key of every priced row that was not `OK` when written, kept for the repair window.
 */
export const STAMP_QUEUE = 'stamp_queue';
export const FLAGGED_ROWS = 'flagged_rows';

export const queueTables = (db: Databases): string[] => [
    `CREATE TABLE IF NOT EXISTS ${qualified(db.analytics, STAMP_QUEUE)}
     (inserted_at DateTime64(3, 'UTC'), account String, event_id String)
     ENGINE = MergeTree ORDER BY inserted_at TTL toDateTime(inserted_at) + INTERVAL 1 DAY`,
    `CREATE TABLE IF NOT EXISTS ${qualified(db.analytics, FLAGGED_ROWS)}
     (timestamp DateTime64(3, 'UTC'), account String, event_id String)
     ENGINE = MergeTree ORDER BY timestamp TTL toDateTime(timestamp) + INTERVAL 7 DAY`,
];

export const queueViews = (db: Databases, pricedTable: string): string[] => [
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${qualified(db.analytics, 'mv_stamp_queue')}
     TO ${qualified(db.analytics, STAMP_QUEUE)}
     AS SELECT now64(3) AS inserted_at, account, event_id FROM ${qualified(db.analytics, USER_TIMELINE)}`,
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${qualified(db.analytics, 'mv_flagged_rows')}
     TO ${qualified(db.analytics, FLAGGED_ROWS)}
     AS SELECT timestamp, account, event_id FROM ${qualified(db.analytics, pricedTable)} WHERE price_flag != 'OK'`,
];
