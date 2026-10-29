import type { ClickhouseClient } from './client.ts';
import { envioChainsTable, timelineEventHistoryTable } from './events.ts';
import { ident, param, qualified, sql } from './sql.ts';

/**
 * An empty stand-in for one of Envio's version databases with what we read: the `TimelineEvent` history table (Envio's
 * columns and sort key, the indexer price columns NULL unless a test sets them), `envio_chains` (the committed
 * checkpoint per chain), and the `Contract`, `ContractLink` and `Token` entity views as plain tables. Tests and
 * load-test setups only. The name goes through `ident` before anything is created (the CLI's `seed-synthetic`
 * passes an operator's argument).
 */
export const createScratchRaw = async (client: ClickhouseClient, raw: string): Promise<void> => {
    await client.command(sql`CREATE DATABASE ${ident(raw)}`);
    await client.command(
        sql`CREATE TABLE ${qualified(raw, timelineEventHistoryTable())}
             (id String, account String,
              kind Enum8('BALANCE' = 1, 'CLM_DEPOSIT' = 2, 'CLM_WITHDRAW' = 3, 'CLAIM' = 4, 'MINT' = 5, 'BURN' = 6),
              contract String, source String, delta String, shares_after String, amount0 String, amount1 String,
              reward_token String, reward_amount String, block_number Decimal(20, 0),
              block_timestamp DateTime64(3, 'UTC'), log_index Int32, trx_hash String,
              head_price Nullable(Float64), head_price_at Nullable(DateTime64(3, 'UTC')), head_product Nullable(String),
              head_decimals Nullable(Int32), head_product_kind Nullable(String), head_contract_kind Nullable(String),
              chain_id Int32,
              envio_checkpoint_id UInt64, envio_change Enum8('SET' = 1, 'DELETE' = 2))
             ENGINE = MergeTree ORDER BY (account, chain_id, block_number, log_index, envio_checkpoint_id)`
    );
    await client.command(
        sql`CREATE TABLE ${qualified(raw, envioChainsTable())} (chain_id Int32, checkpoint_id UInt64, updated_at DateTime64(6, 'UTC') DEFAULT now64(6))
             ENGINE = ReplacingMergeTree(updated_at) ORDER BY chain_id`
    );
    await client.command(
        sql`CREATE TABLE ${qualified(raw, 'Token')} (chain_id Int32, address String, decimals Nullable(Int32)) ENGINE = MergeTree ORDER BY address`
    );
    await client.command(
        sql`CREATE TABLE ${qualified(raw, 'Contract')} (chain_id Int32, address String, kind String) ENGINE = MergeTree ORDER BY address`
    );
    await client.command(
        sql`CREATE TABLE ${qualified(raw, 'ContractLink')}
             (chain_id Int32, from_address String, to_address String, relation String, since_block Decimal(20, 0))
             ENGINE = MergeTree ORDER BY from_address`
    );
};

/** A row of {@link createScratchRaw}'s history table; amounts are decimal strings, as Envio writes them. */
export type TimelineEventRow = {
    id: string;
    chain_id: number;
    account: string;
    kind: 'BALANCE' | 'CLM_DEPOSIT' | 'CLM_WITHDRAW' | 'CLAIM' | 'MINT' | 'BURN';
    contract: string;
    source: string;
    delta: string;
    shares_after: string;
    amount0: string;
    amount1: string;
    reward_token: string;
    reward_amount: string;
    /** A number, or a decimal string for one past 2^53. */
    block_number: number | string;
    /** UTC `YYYY-MM-DD HH:MM:SS[.fff]`. */
    block_timestamp: string;
    log_index: number;
    trx_hash: string;
    envio_checkpoint_id: number;
    envio_change: 'SET' | 'DELETE';
    head_price: number | null;
    head_price_at: string | null;
    head_product: string | null;
    head_decimals: number | null;
    head_product_kind: string | null;
    head_contract_kind: string | null;
};

/** A balance change with the indexer price columns NULL (neither priced nor facts known); override what a test needs. */
export const timelineEvent = (
    row: Partial<TimelineEventRow> & Pick<TimelineEventRow, 'id' | 'account' | 'block_timestamp'>
): TimelineEventRow => ({
    chain_id: 8453,
    kind: 'BALANCE',
    contract: '',
    source: 'TRANSFER',
    delta: '0',
    shares_after: '0',
    amount0: '0',
    amount1: '0',
    reward_token: '',
    reward_amount: '0',
    block_number: 1,
    log_index: 1,
    trx_hash: `0x${row.id}`,
    envio_checkpoint_id: 1,
    envio_change: 'SET',
    head_price: null,
    head_price_at: null,
    head_product: null,
    head_decimals: null,
    head_product_kind: null,
    head_contract_kind: null,
    ...row,
});

/** Writes history rows into {@link createScratchRaw}'s table, as Envio does. */
export const insertTimelineEvents = (
    client: ClickhouseClient,
    raw: string,
    rows: readonly TimelineEventRow[]
): Promise<void> => client.insert(qualified(raw, timelineEventHistoryTable()), rows);

/** Moves Envio's committed checkpoint of a chain, as Envio does after each batch. */
export const commitCheckpoint = (
    client: ClickhouseClient,
    raw: string,
    chainId: number,
    checkpoint: number
): Promise<void> =>
    client.command(
        sql`INSERT INTO ${qualified(raw, envioChainsTable())} (chain_id, checkpoint_id, updated_at)
         SELECT ${param('Int32', chainId)}, ${param('UInt64', checkpoint)}, now64(6)`
    );

/** Reprice settings for tests: one statement per test range unless a test asks for smaller ones. */
export const testRepriceSettings = () => ({
    stepDays: 400,
    maxEventsPerStatement: 500_000,
    maxMemoryBytes: 4 * 1024 * 1024 * 1024,
    maxExecutionSeconds: 600,
    retryDays: 7,
    pendingGraceSeconds: 15 * 60,
    watermarkMinAgeSeconds: 86_400,
});
