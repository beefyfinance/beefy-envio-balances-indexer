CREATE TABLE IF NOT EXISTS logs (
    chain_id int NOT NULL, block_number bigint NOT NULL, log_index int NOT NULL, block_hash bytea NOT NULL,
    tx_hash bytea NOT NULL, tx_index int NOT NULL, address bytea NOT NULL,
    topic0 bytea, topic1 bytea, topic2 bytea, topic3 bytea, data bytea NOT NULL,
    final boolean NOT NULL, tip_hash bytea,
    PRIMARY KEY (chain_id, block_hash, log_index)
);
CREATE INDEX IF NOT EXISTS logs_by_block ON logs (chain_id, block_number);
-- which block ranges are known complete for one address and event; adjacent ranges merge on their own
CREATE TABLE IF NOT EXISTS log_coverage (
    chain_id int NOT NULL, address bytea NOT NULL, topic0 bytea NOT NULL,
    final int8multirange NOT NULL DEFAULT '{}',
    PRIMARY KEY (chain_id, address, topic0)
);
-- near the head: coverage for one exact filter, trusted only while the block hash of its tip is still canonical
CREATE TABLE IF NOT EXISTS log_tentative (
    chain_id int NOT NULL, filter_hash bytea NOT NULL, blocks int8range NOT NULL,
    tip_number bigint NOT NULL, tip_hash bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS log_tentative_filter ON log_tentative USING gist (blocks);
CREATE TABLE IF NOT EXISTS blocks (
    chain_id int NOT NULL, number bigint NOT NULL, full_txs boolean NOT NULL, hash bytea, final boolean NOT NULL, raw text NOT NULL,
    PRIMARY KEY (chain_id, number, full_txs)
);
CREATE TABLE IF NOT EXISTS transactions (
    chain_id int NOT NULL, hash bytea NOT NULL, block_number bigint, final boolean NOT NULL, raw text NOT NULL,
    PRIMARY KEY (chain_id, hash)
);
CREATE TABLE IF NOT EXISTS calls (
    chain_id int NOT NULL, key bytea NOT NULL, block_number bigint NOT NULL, final boolean NOT NULL, result bytea NOT NULL,
    PRIMARY KEY (chain_id, key)
);
