# RPC cache proxy

A local JSON-RPC proxy for reindexing. It sits between an indexer and a node (or the [rpc-pacer](../indexer/README.md#rate-limited-rpcs)):

```
Envio  ->  rpc-cache-proxy  ->  rpc-pacer  ->  public RPCs
              |
           Postgres (logs, blocks, transactions, eth_calls)
```

Everything it sees is recorded in Postgres, in batches that never delay an answer. What the cache knows to be final is
answered from there, so replaying a backfill after a handler fix costs a few requests instead of hours. It is a dev and
test tool: nothing in production uses it, and it listens on loopback only.

Measured on a real reindex (Optimism 8.1M blocks, MegaETH 22.8M, 497,424 rows, identical rows on every run): 9 h 33 and
59 min to fill, 17 min and 6 min 42 replayed from Postgres, 13 min and 7 min from Parquet. Requests fell from 338k and
106k to 9k-21k. What still reaches the node is blocks at Envio's range bounds: every cached block without a log was one
(56% of blocks), and the ranges change between runs.

## Run it

```bash
cp .env.example .env            # CHAIN_ID, UPSTREAM_URL, PORT, DATABASE_URL, SERVE
pnpm schema                     # creates the tables in DATABASE_URL (idempotent)
pnpm start                      # one proxy per chain
```

Point `ENVIO_RPC_URL_<chain>` at `http://127.0.0.1:<PORT>`. `GET /stats` returns the counters (per method: requests,
hits, partial hits, misses, uncacheable, upstream calls, lookup and upstream timings, write counters); `STATS_FILE` also
writes them to a file every `REPORT_SECONDS`.

| variable | meaning |
|---|---|
| `SERVE` | what may be answered from the cache: `logs,blocks,txs,calls`. Everything is recorded whatever this says, so a first run can fill the cache with nothing served. |
| `CACHE=off` | forward everything and record nothing |
| `REORG_DEPTH` | blocks this far below the highest block seen are final (default 200); only final data is served |
| `MAX_QUEUE` | rows waiting to be written above which new ones are dropped (counted in `writes.dropped`), so recording never holds an answer back |

## What is cached, and when it is trusted

- **`eth_getLogs`** for an address list and one topic0 list (nothing on the other topics). Coverage is kept as Postgres
  multiranges per `(address, topic0)`; adjacent ranges merge. A request is answered from Postgres for the covered part,
  and only the gaps go to the node and are recorded. A filter with `blockHash`, a block tag instead of a number, or
  constraints on topics 1-3 is forwarded as received.
- **Near the head** coverage is kept for the exact filter only, up to its last log, and trusted only while that log's
  block hash is still the node's canonical one (checked with `eth_getBlockByNumber`, remembered for 5 s). One stale tip
  and the node is asked for the whole range. Rows stay in the table when a fork loses, but are never served: a log is
  served only if it is final or sits under a tip that was just verified.
- **`eth_getBlockByNumber`, `eth_getTransactionByHash`, `eth_call`** at an explicit block: recorded always, served only
  once the block is final. `eth_call` keys are a hash of the call and the block.
- Everything else (batches, other methods, block tags) is forwarded. `eth_blockNumber` answers move the head.

## Tests

```bash
pnpm test                       # types, unit tests, lint
createdb rpc_cache_test && psql rpc_cache_test -f sql/schema.sql
DATABASE_URL=postgres://… pnpm test:integration   # a fake node that switches fork behind the real proxy
```

The integration test touches only chain id 999999: cold fill, a repeat, a reorg (the old fork must never be served), a
block near the head, the move to final, and a wider range that only asks the node for what is missing.

## Parquet

`scripts/parquet.sh export <dir> <chainId>...` writes the final rows of a chain as zstd Parquet (no near-head data),
`restore` loads them into empty tables, and `checksums` prints one md5 per table and chain, so a round trip can be
diffed. It needs `psql` and `duckdb`. Measured on two Optimism windows: 280-520 bytes per timeline row with whole RPC
responses, 43-70 with selected fields; 100k logs reload in 0.5 s and 10M in 47 s, and an Envio replay from a restored
cache wrote identical rows.

## Origin

Rebuilt on 2026-11-12 from the prototype written on 2026-10-31 (session transcripts), which was never committed: the
same cache design, with the schema (`sql/schema.sql`) and queries unchanged, split into modules, zod-parsed upstream
answers, the repo's logger, config and lint rules, and a bounded timing sample so a long run does not leak. The benchmark
scripts of the prototype (`run-bench.sh`, `reindex.sh`) depended on a scratch directory and are not part of the app.
