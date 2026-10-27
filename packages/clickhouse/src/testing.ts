import type { ClickhouseClient } from './client.ts';

/** An empty stand-in for the indexer's database with the tables the views and the stamping read. Tests only. */
export const createScratchRaw = async (client: ClickhouseClient, raw: string): Promise<void> => {
    await client.command(`CREATE DATABASE ${raw}`);
    await client.command(
        `CREATE TABLE ${raw}.envio_history_BalanceChange
             (id String, token String, account String, delta String, balance_after String,
              source Enum8('TRANSFER' = 1, 'BOOST_STAKE' = 2), block_number Decimal(20, 0),
              block_timestamp DateTime64(3, 'UTC'), trx_hash String, trx_from Nullable(String), log_index Int32,
              chain_id Int32, envio_checkpoint_id UInt64, envio_change Enum8('SET' = 1, 'DELETE' = 2))
             ENGINE = MergeTree ORDER BY (chain_id, token, account, block_number, log_index, envio_checkpoint_id)`
    );
    await client.command(
        `CREATE TABLE ${raw}.envio_history_ShareTransfer
             (id String, token String, from_address String, to_address String, value String,
              total_supply_after Nullable(String), block_number Decimal(20, 0), block_timestamp DateTime64(3, 'UTC'),
              trx_hash String, trx_from Nullable(String), log_index Int32, chain_id Int32, envio_checkpoint_id UInt64,
              envio_change Enum8('SET' = 1, 'DELETE' = 2))
             ENGINE = MergeTree ORDER BY (chain_id, token, block_number, log_index, envio_checkpoint_id)`
    );
    await client.command(
        `CREATE TABLE ${raw}.envio_history_ClmDeposit
             (id String, manager String, user String, shares String, amount0 String, amount1 String, fee0 String,
              fee1 String, block_number Decimal(20, 0), block_timestamp DateTime64(3, 'UTC'), trx_hash String,
              trx_from Nullable(String), log_index Int32, chain_id Int32, envio_checkpoint_id UInt64,
              envio_change Enum8('SET' = 1, 'DELETE' = 2))
             ENGINE = MergeTree ORDER BY (chain_id, manager, block_number, log_index, envio_checkpoint_id)`
    );
    await client.command(
        `CREATE TABLE ${raw}.envio_history_ClmWithdraw
             (id String, manager String, user String, shares String, amount0 String, amount1 String,
              block_number Decimal(20, 0), block_timestamp DateTime64(3, 'UTC'), trx_hash String,
              trx_from Nullable(String), log_index Int32, chain_id Int32, envio_checkpoint_id UInt64,
              envio_change Enum8('SET' = 1, 'DELETE' = 2))
             ENGINE = MergeTree ORDER BY (chain_id, manager, block_number, log_index, envio_checkpoint_id)`
    );
    await client.command(
        `CREATE TABLE ${raw}.envio_history_RewardPaid
             (id String, contract String, source Enum8('BOOST' = 1, 'REWARD_POOL' = 2), user String,
              reward_token Nullable(String), amount String, block_number Decimal(20, 0),
              block_timestamp DateTime64(3, 'UTC'), trx_hash String, trx_from Nullable(String), log_index Int32,
              chain_id Int32, envio_checkpoint_id UInt64, envio_change Enum8('SET' = 1, 'DELETE' = 2))
             ENGINE = MergeTree ORDER BY (chain_id, contract, block_number, log_index, envio_checkpoint_id)`
    );
    await client.command(
        `CREATE TABLE ${raw}.Token (chain_id Int32, address String, decimals Nullable(Int32)) ENGINE = MergeTree ORDER BY address`
    );
    await client.command(
        `CREATE TABLE ${raw}.Contract (chain_id Int32, address String, kind String) ENGINE = MergeTree ORDER BY address`
    );
    await client.command(
        `CREATE TABLE ${raw}.ContractLink (chain_id Int32, from_address String, to_address String, relation String)
             ENGINE = MergeTree ORDER BY from_address`
    );
};
