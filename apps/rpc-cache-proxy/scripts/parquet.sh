#!/bin/bash
# Moves the final data of the cache between Postgres and zstd Parquet files, so a cache can be kept or shipped at a
# fraction of its size (measured: 806 B per timeline row in Parquet against 2.6 kB in Postgres, 89% of it blocks).
#
#   scripts/parquet.sh export <dir> <chainId>...   final rows of each chain into <dir>/<table>.<chainId>.parquet
#   scripts/parquet.sh restore <dir> <chainId>...  loads them back (the tables must not hold those rows yet)
#   scripts/parquet.sh checksums                   one md5 per table and chain, to diff before an export and after a restore
#
# Needs psql and the duckdb CLI on the PATH, and DATABASE_URL (the database holding sql/schema.sql). Only final data is
# exported: nothing near the head, so a restored cache never serves a block that could still be reorged.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
ZSTD_LEVEL="${ZSTD_LEVEL:-3}"
sql() { psql "$DATABASE_URL" -At "$@"; }
COPY_OPTIONS="WITH (FORMAT csv, HEADER)"
PARQUET_OPTIONS="(FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL $ZSTD_LEVEL)"

export_chain() { # dir chain
  local dir=$1 c=$2
  cd "$dir"
  sql -c "\\copy (SELECT block_number, log_index, encode(block_hash,'hex') block_hash, encode(tx_hash,'hex') tx_hash, tx_index, encode(address,'hex') address, encode(topic0,'hex') topic0, encode(topic1,'hex') topic1, encode(topic2,'hex') topic2, encode(topic3,'hex') topic3, encode(data,'hex') data FROM logs WHERE chain_id=$c AND final ORDER BY block_number, log_index) TO 'logs.$c.csv' $COPY_OPTIONS"
  sql -c "\\copy (SELECT number, full_txs, encode(hash,'hex') hash, raw FROM blocks WHERE chain_id=$c AND final ORDER BY number) TO 'blocks.$c.csv' $COPY_OPTIONS"
  sql -c "\\copy (SELECT block_number, encode(hash,'hex') hash, raw FROM transactions WHERE chain_id=$c AND final ORDER BY block_number, hash) TO 'txs.$c.csv' $COPY_OPTIONS"
  sql -c "\\copy (SELECT block_number, encode(key,'hex') AS key, encode(result,'hex') AS result FROM calls WHERE chain_id=$c AND final ORDER BY block_number, key) TO 'calls.$c.csv' $COPY_OPTIONS"
  sql -c "\\copy (SELECT encode(address,'hex') address, encode(topic0,'hex') topic0, final::text blocks FROM log_coverage WHERE chain_id=$c) TO 'coverage.$c.csv' $COPY_OPTIONS"
  HOME=$PWD duckdb <<DUCK
COPY (SELECT block_number::BIGINT block_number, log_index::INT log_index, unhex(block_hash) block_hash, unhex(tx_hash) tx_hash, tx_index::INT tx_index, unhex(address) address, unhex(topic0) topic0, unhex(topic1) topic1, unhex(topic2) topic2, unhex(topic3) topic3, unhex(coalesce(data,'')) AS data FROM read_csv('logs.$c.csv', header=true, all_varchar=true)) TO 'logs.$c.parquet' $PARQUET_OPTIONS;
COPY (SELECT number::BIGINT number, full_txs::BOOLEAN full_txs, unhex(hash) hash, raw FROM read_csv('blocks.$c.csv', header=true, all_varchar=true, max_line_size=100000000)) TO 'blocks.$c.parquet' $PARQUET_OPTIONS;
COPY (SELECT block_number::BIGINT block_number, unhex(hash) hash, raw FROM read_csv('txs.$c.csv', header=true, all_varchar=true, max_line_size=100000000)) TO 'txs.$c.parquet' $PARQUET_OPTIONS;
COPY (SELECT block_number::BIGINT block_number, unhex(key) AS key, unhex(coalesce(result,'')) AS result FROM read_csv('calls.$c.csv', header=true, all_varchar=true, max_line_size=100000000)) TO 'calls.$c.parquet' $PARQUET_OPTIONS;
COPY (SELECT address, topic0, blocks FROM read_csv('coverage.$c.csv', header=true, all_varchar=true, max_line_size=100000000)) TO 'coverage.$c.parquet' $PARQUET_OPTIONS;
DUCK
  rm -f ./*."$c".csv
}

restore_chain() { # dir chain
  local dir=$1 c=$2
  cd "$dir"
  duck() { HOME=$PWD duckdb -csv -noheader -nullvalue "" -c "$1"; }
  duck "SELECT $c, block_number, log_index, '\\x'||hex(block_hash), '\\x'||hex(tx_hash), tx_index, '\\x'||hex(address), '\\x'||hex(topic0), '\\x'||hex(topic1), '\\x'||hex(topic2), '\\x'||hex(topic3), '\\x'||hex(data), true, NULL FROM 'logs.$c.parquet'" | sql -q -c "\\copy logs FROM STDIN WITH (FORMAT csv)"
  duck "SELECT $c, number, full_txs, '\\x'||hex(hash), true, raw FROM 'blocks.$c.parquet'" | sql -q -c "\\copy blocks FROM STDIN WITH (FORMAT csv)"
  duck "SELECT $c, '\\x'||hex(hash), block_number, true, raw FROM 'txs.$c.parquet'" | sql -q -c "\\copy transactions FROM STDIN WITH (FORMAT csv)"
  duck "SELECT $c, '\\x'||hex(key), block_number, true, '\\x'||hex(result) FROM 'calls.$c.parquet'" | sql -q -c "\\copy calls FROM STDIN WITH (FORMAT csv)"
  duck "SELECT $c, '\\x'||address, '\\x'||topic0, blocks FROM 'coverage.$c.parquet'" | sql -q -c "\\copy log_coverage FROM STDIN WITH (FORMAT csv)"
}

checksums() {
  sql -F ' ' <<'SQL'
SELECT 'logs', chain_id, count(*), md5(string_agg(x,'' ORDER BY x)) FROM (SELECT chain_id, md5(ROW(block_number,log_index,block_hash,tx_hash,tx_index,address,topic0,topic1,topic2,topic3,data)::text) x FROM logs WHERE final) s GROUP BY 2 ORDER BY 2;
SELECT 'blocks', chain_id, count(*), md5(string_agg(x,'' ORDER BY x)) FROM (SELECT chain_id, md5(ROW(number,full_txs,hash,raw)::text) x FROM blocks WHERE final) s GROUP BY 2 ORDER BY 2;
SELECT 'txs', chain_id, count(*), md5(string_agg(x,'' ORDER BY x)) FROM (SELECT chain_id, md5(ROW(block_number,hash,raw)::text) x FROM transactions WHERE final) s GROUP BY 2 ORDER BY 2;
SELECT 'calls', chain_id, count(*), md5(string_agg(x,'' ORDER BY x)) FROM (SELECT chain_id, md5(ROW(block_number,key,result)::text) x FROM calls WHERE final) s GROUP BY 2 ORDER BY 2;
SELECT 'coverage', chain_id, count(*), md5(string_agg(x,'' ORDER BY x)) FROM (SELECT chain_id, md5(ROW(address,topic0,final)::text) x FROM log_coverage) s GROUP BY 2 ORDER BY 2;
SQL
}

command=${1:-}
case "$command" in
  export | restore)
    dir=${2:?usage: parquet.sh $command <dir> <chainId>...}
    shift 2
    [ $# -gt 0 ] || { echo "no chain ids given" >&2; exit 1; }
    mkdir -p "$dir"
    dir=$(cd "$dir" && pwd)
    for chain in "$@"; do "${command}_chain" "$dir" "$chain"; done
    ;;
  checksums) checksums ;;
  *) sed -n '2,12p' "$0" >&2; exit 1 ;;
esac
