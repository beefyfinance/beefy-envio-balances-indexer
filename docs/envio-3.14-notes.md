# Envio 3.14 notes

What you need when working on this indexer: `envio@3.14.1`'s gotchas and the settings we rely on. For everything else
use [docs.envio.dev](https://docs.envio.dev). Where docs and package disagree the package wins: read
`node_modules/envio/src/*.res` (`pkg/` below), `index.d.ts`, `evm.schema.json` and the generated `.envio/types.d.ts`.
"UNVERIFIED" means not confirmed from source or a run. Paths are relative to `apps/indexer/`.

## Constraints

1. Handlers read only Postgres. A ClickHouse-only entity throws on `get`, `getWhere`, `getOrThrow` and `getOrCreate`.
2. `contractRegister` has no effects and no entity access. Any RPC read there is uncached and reruns on every reindex.
3. A handler runs twice per batch. Preload runs all handlers concurrently, with `set` a no-op and exceptions swallowed.
   Processing runs them in order, and exceptions crash the indexer. So never call RPC directly in a handler, and do reads
   and effects first, with `Promise.all`. Preload sees the database, not earlier writes of the batch.
4. Any config or schema change that lands in the stored config (start or end block, static addresses, contracts, events,
   entities, storage) makes a resume refuse and needs `-r`. Handler changes need no `-r`, but stored rows are not recomputed.
5. Keep Envio's ClickHouse database dedicated: Envio recreates it on init. Never run two indexers against one.

## Settings we rely on

| Setting | Why |
|---|---|
| `disable_default_cross_chain: true` | per-chain entity keys, rollbacks and effect caches; required for multi-process |
| `address_format: lowercase` | every address surfaced to handlers is lowercase |
| `storage`: Postgres `default: false`, ClickHouse `default: true`, both `snake_case` | events in ClickHouse only; entities opt into Postgres |
| `field_selection`: `transaction_fields: [hash, from]` | `from` labels zaps; `input` only on ClassicVaultFactory events |
| `rpc[].for: ${ENVIO_RPC_FOR:-fallback}` | one config for HyperSync and RPC-only runs |

- `chainId` is reserved in per-chain mode: do not declare it. Ids still start with the chain id so they stay unique in
  ClickHouse. `get(id)` reads the handler's chain, and entity objects carry no `chainId`.
- Inline `fields` on a registration replaces the selection: only `block.number` stays implicit. `transaction.from` is
  typed `Address | undefined`, and `block.timestamp` is unix seconds.

## Schema and storage

- Each entity gets `envio_history_<Entity>` in ClickHouse, with every change (`envio_checkpoint_id`, `envio_change`), and a
  view named after the entity with the latest row per id. `scripts/integrity` queries these views.
- `@storage(clickhouse: {orderBy, skippingIndexes, partitionBy, ttl})` applies to the history table. `orderBy` cannot list
  `id` or nullable, list or derived fields.
- `@index` has no effect on ClickHouse. In Postgres, indexes are created when the backfill finishes, and a `getWhere` on
  any non-derived field builds what it needs on demand, pausing indexing.
- `@config(precision: N)` on a `BigInt` sets the ClickHouse Decimal precision. Without it the value is a string.

## Handlers

- Returned entities are frozen: spread before changing.
- An address can be registered under several contracts, and each registration routes the log separately. Ambiguous proxies
  rely on this (`src/handlers/factories.test.ts`).
- Re-registering an address for the same contract is skipped, so a known contract costs nothing at its factory event.

## Effects

- `rateLimit` is required (`false` here). `crossChain: false` on every effect.
- The cache key hashes the serialised input. Pass plain values: `Uint8Array` and `Date` throw, and there is no bytes schema.
  Normalise address case. `createEffect` turns an object-literal `input` into a schema in place, so never share a literal.
- Tables are `envio_<chainId>_effect_<name>`. Renaming an effect starts a new table. A cached row that no longer parses is
  refetched.
- A throw rejects `context.effect`: it aborts that event's preload, and crashes the indexer in processing. There is no
  retry and nothing is cached. Our pattern: transport errors throw, reverts return a status safe to cache, and
  `context.cache = false` skips caching an incomplete answer.
- Cache rows are not rolled back on reorg. Reads pinned to a block are safe outside a reorged block, and reads at `latest`
  are frozen at first call.

| Situation | Effect cache kept? |
|---|---|
| restart, crash resume (no `-r`) | yes |
| `-r`, `envio local db-migrate setup/down`, first run on an empty schema | no: dropped, then restored from `.envio/cache` if present |
| `envio stop` | no: deletes the local Docker volumes |

`.envio/cache/<chainId>/<name>.tsv` is the only persistence across a reindex. Restore uses `psql`, local or through
`docker exec`, and on failure logs "Failed to upload cache, continuing without it." Dump is `POST
/console/syncCache`, only under `envio dev`. Otherwise dump by hand with `COPY "<schema>"."envio_<chainId>_effect_<name>"
TO STDOUT WITH (FORMAT text, HEADER)`. Directory names must be chain ids.

## Multi-process

`ENVIO_PG_MAX_CONNECTIONS` is the budget of the whole run, default 2, which keeps one process. From 4 and up Envio starts
min(chains, connections / 2, 4) workers (`pkg/src/Supervisor.res`), and only when no entity is shared. Chains are dealt in
config order, reversing direction each pass, so listing the busiest first is the only balancing there is.

Chains of one worker are not independent. During a backfill a chain may not fetch past the slowest chain of its worker's
progress plus 20% of its own range (`alignmentMargin`, `pkg/src/CrossChainState.res`, not configurable), until the worker's
chains reach their head. A chain with no query in flight is usually clamped by a slow worker-mate, not broken.

For full isolation run one process per chain or group: `envio local db-migrate up` once with the full config, then
`ENVIO_INDEXER_PORT=<port> envio start --chain <id>` (repeatable). `-r` cannot be combined with `--chain`. Each process has
its own port and its own Beefy API polling.

## Running

| Env | Note |
|---|---|
| `ENVIO_PG_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_DATABASE` | setting the host skips the Postgres container; dev fallbacks apply only outside production |
| `ENVIO_PG_SCHEMA` | falls back to `ENVIO_PG_PUBLIC_SCHEMA`, then `public`; refuses a schema with non-Envio tables |
| `ENVIO_CLICKHOUSE_HOST`, `_DATABASE`, `_USERNAME`, `_PASSWORD` | all four required; the password may be empty but must be set |
| `ENVIO_INDEXER_PORT` | default 9898: `/healthz`, `/metrics`, `/console/*` |
| `ENVIO_IN_MEMORY_OBJECTS_TARGET` | default 100 000; lower it to flush to Postgres sooner |

- **Restart past 1M rows.** On resume Envio scans every `envio_history_*` table for rows past the committed checkpoint. On
  databarn the user's `max_rows_to_read` (1 000 000) makes that fail: `TOO_MANY_ROWS`, "Failed to resume ClickHouse storage".
  The user may raise it per query, so set `ENVIO_CLICKHOUSE_HOST=<url>?max_rows_to_read=0`. Production needs this or a
  higher cap, or a restart fails.
- `dev` and `start` refuse to start on a handler type error.
- Switching configs on one Postgres schema needs `-r`, so use a different `ENVIO_PG_SCHEMA`. `ENVIO_RPC_FOR` needs no `-r`.

Progress: `curl localhost:9898/metrics` or `envio metrics`, `/console/state`, and `select * from "<schema>".envio_chains`.

## Testing

`createTestIndexer().process(...)` drives handlers (helpers in `test/helpers/simulate.ts`, `test/independent/harness.ts`).

- An item that reaches no handler fails the run, so register dynamic contracts first. Two items on one `(block, logIndex)`
  throw. A simulated block defaults to the previous item's number and timestamp 0.
- Effects run for real with an empty cache, and `src/lib/rpcFixtures.ts` keeps RPC deterministic. Module state is shared
  across test indexers in a file, and handlers load outside vitest's module graph.
- There is no reorg support. Entities in `sets` carry no `chainId`; `getWhere` and `set` on the test indexer need it.

## RPC sync cost model

From Envio's Rust RPC source (enviodev/hyperindex, `packages/cli/src/evm_rpc_source/`), `pkg/src/FetchState.res` and live
runs. HyperSync serves all fields in one query, so none of this applies to it.

### Requests

| Data | Source | Cost |
|---|---|---|
| params, `logIndex`, `srcAddress`, `block.number`, `transaction.hash` | the log | 0 |
| `block.timestamp`, `block.hash` | `eth_getBlockByNumber(n, false)` | 1 per block with a handled event |
| `transaction.from`, `to`, `input`, ... | `eth_getTransactionByHash` | 1 per transaction with a handled event |
| receipt fields | `eth_getTransactionReceipt` | 1 per transaction (not selected here) |

Requests are one HTTP POST each, with at most 100 in flight per source. Concurrent requests for one block or transaction are
coalesced, with no cache. So selecting `transaction.from` roughly doubles the requests per event, and these calls dominate
over `eth_getLogs`.

### Ranges, partitions, concurrency

- Range per `eth_getLogs`: `initial_block_interval` (10 000), plus `acceleration_additive` (500) after a success up to
  `interval_ceiling` (10 000), times `backoff_multiplicative` (0.8) after an error, then `backoff_millis` (2 000). A
  provider's "range too large" message is parsed and retried with its size.
- `query_timeout_millis` defaults to 20 000. A timeout shrinks the range, so a slow upstream collapses it: raise this
  on the `rpc` entry rather than fight the range.
- One `eth_getLogs` stream per partition, an address set with its own `latestFetchedBlock`. Up to 100 queries per chain,
  hard-coded. No knob caps partitions or per-chain concurrency.
- Static addresses of a contract chunk by `MAX_PARTITION_SIZE` (default 5 000). Static partitions merge when their start
  blocks are within 20 000 blocks.
- Dynamic registrations make one partition per contract name per group of blocks within 20 000, which is why
  [known contracts](architecture.md#known-contracts) are listed statically.
- `MAX_PARTITION_SIZE=250` on RPC-only runs: a filter of thousands of addresses answers slower than the query timeout on
  rpc.beefy.com. It is eRPC and rejects ranges above 30 000 blocks (some upstreams above 1 000).

### Choosing an RPC

Envio has no rate setting: use `pnpm rpc-pacer` (see the [indexer README](../apps/indexer/README.md#rate-limited-rpcs)). A
public RPC can look fine at the head and be useless for a backfill. Probe old blocks with the real address list, and check
`eth_getLogs`, a full block, an old transaction and old state. Effects need archive state.
