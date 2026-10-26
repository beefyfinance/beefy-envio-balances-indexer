# Envio HyperIndex 3.14.1 reference

APIs and runtime behaviour of `envio@3.14.1` as used by this indexer. Sources, in order of trust: the installed
package (`node_modules/envio/src/*.res`, `index.d.ts`, `evm.schema.json`), the generated `.envio/types.d.ts`, the
public Rust RPC source (enviodev/hyperindex `packages/cli/src/evm_rpc_source/`), `envio <cmd> --help`, then
docs.envio.dev and the GitHub release notes. Where docs and package disagree, the package wins.

Notation: `pkg/` = `node_modules/envio/`. "UNVERIFIED" = not confirmed from source, tests or a run of this repo.
Node >= 22.15 (`pkg/package.json` `engines`).

## Key constraints

1. Handlers can only read Postgres. A ClickHouse-only entity throws on `get` / `getWhere` / `getOrThrow` /
   `getOrCreate` ("ClickHouse storage is currently write-only"). Source: `pkg/src/UserContext.res:143-245`.
2. ClickHouse is "a sync of the Postgres storage" (`pkg/src/PgStorage.res:2754-2756`). On (re)initialisation the
   native sink recreates the database named by `ENVIO_CLICKHOUSE_DATABASE` (inferred from the binary's
   `TRUNCATE DATABASE` / `DROP DATABASE` / `CREATE DATABASE` strings; exact trigger UNVERIFIED). Never put anything
   else in that database.
3. The effect cache lives in Postgres and survives a restart, but `-r` (any re-initialisation) drops the schema,
   cache included. The only built-in persistence across a reindex is the `.envio/cache/*.tsv` dump / restore
   (section 4.4).
4. `contractRegister` has no `effect` and no entity access: any RPC read there is uncached and re-runs on every
   reindex.
5. Any change to config.yaml or the schema that lands in the stored config (start / end block, static addresses,
   contracts, events, entities, storage) makes a resume incompatible and requires `-r` (`pkg/src/ResumePlan.res`).

## 1. config.yaml

Schema: `pkg/evm.schema.json` (`# yaml-language-server: $schema=./node_modules/envio/evm.schema.json`). Top-level
keys: `name`, `description`, `schema`, `handlers`, `full_batch_size`, `storage`, `disable_default_cross_chain`,
`ecosystem`, `contracts`, `chains`, `rollback_on_reorg`, `save_full_history`, `field_selection`, `raw_events`,
`address_format`, `bytes_type`. Required: `name`, `chains`.

Removed in V3 (codegen rejects them): `preload_handlers`, `loaders`, `unordered_multichain_mode`, `multichain`,
`rpc_config`, `event_decoder`, `networks` (now `chains`), `confirmed_block_threshold` (now `max_reorg_depth`).

### 1.1 Contracts, events, chains

```yaml
schema: schema.graphql            # optional custom path (lets an alternate config use an alternate schema)
handlers: src/handlers            # default; auto-loads every file except *.test.* / *_test.*
full_batch_size: 5000             # default 5000

contracts:                        # global: abi + events, no addresses
  - name: ClassicStrategyFactory
    abi_file_path: abis/beefy/classic/ClassicStrategyFactory.json
    events:
      - event: "ProxyCreated(address proxy)"
        name: StrategyCreated                               # rename; unique per contract
      - event: "ProxyCreated(string strategyName, address proxy)"
        name: StrategyCreatedWithName

chains:
  - id: 8453
    start_block: 0                # integer or "latest"; required
    end_block: 25000000           # optional; envio start exits when all chains reach it
    max_reorg_depth: 200          # optional
    contracts:
      - name: ClassicStrategyFactory
        address: ["0x..."]        # string or list
        start_block: 2000000      # optional per-contract start
      - name: ClassicStrategy     # no address => dynamic only
```

Per-event start block without touching config: `where: { block: { number: { _gte: N } } }` on `onEvent`.

### 1.2 field_selection

Three levels, most specific wins: root `field_selection`, per event in config.yaml, per handler (`fields` on
`onEvent` / `contractRegister`).

- Without `fields`, the default block fields are `number`, `timestamp`, `hash`; no transaction field is selected
  unless listed (`.envio/types.d.ts`).
- Inline `fields` replaces the selection for that registration: only `block.number` is implicit, and reading an
  unlisted field is a type error. `fields` must be a literal (inline or `as const`).
- `transaction.from` is typed `Address | undefined`; `block.timestamp` is unix seconds.

### 1.3 Chains, RPC, HyperSync

- HyperSync is used automatically for supported chain ids and needs `ENVIO_API_TOKEN`.
- `rpc` accepts a string, an object or a list. `for`: `sync` (RPC is the historical and realtime source), `fallback`
  (default when HyperSync exists), `realtime` (HyperSync backfill, then RPC at the head). Defining both
  `hypersync_config` and a `for: sync` RPC is an error.
- Per-entry tuning: `initial_block_interval`, `backoff_multiplicative`, `acceleration_additive`, `interval_ceiling`,
  `backoff_millis`, `fallback_stall_timeout`, `query_timeout_millis`, `polling_interval`, `ws`, `headers`. An entry
  whose url resolves empty (`${ENVIO_RPC_URL:-}`) is ignored.
- Env interpolation: `${VAR}`, `${VAR:-default}`, nested `${A:-${B}}`. Only `ENVIO_*` vars are forwarded on Envio
  Cloud.

### 1.4 address_format, bytes_type

- `address_format: lowercase` lowercases every address the indexer surfaces (`event.srcAddress`, params,
  `transaction.from`, `chain.<C>.addresses`, addresses passed to `.add()`). Default `checksum`.
- `bytes_type: uint8array` makes schema `Bytes` fields `Uint8Array` (`BYTEA` in Postgres); default `hex`. Changing
  it requires a full resync. Event params of type `address` stay strings.

### 1.5 raw_events, save_full_history, rollback_on_reorg, disable_default_cross_chain

- `raw_events: true` writes every event to a `raw_events` table (debug aid, slower). Default false.
- `save_full_history: true` keeps entity history beyond the reorg window. Default false.
- `rollback_on_reorg` default true.
- `disable_default_cross_chain: true` (default in v4): entity tables get a composite `(id, chainId)` key, ids only
  need to be unique per chain, reorg rollback is per chain, effects without `crossChain` get a per-chain cache. The
  column `chainId` is reserved and added automatically. Required for `envio start --chain` and automatic
  multi-process mode.

### 1.6 storage: Postgres and ClickHouse

```yaml
storage:
  postgres:                     # true | {default, column_name_format}; must not be false
    default: false              # default: true when Postgres is the only backend
    column_name_format: snake_case   # original (default) | snake_case
  clickhouse:                   # true | {default, column_name_format}; requires postgres
    default: true
    column_name_format: snake_case
```

- Postgres is the system of record: Envio state (`envio_chains`, `envio_checkpoints`, `envio_addresses`, ...), effect
  caches, entity tables with Postgres storage, entity history for reorgs, Hasura metadata.
- ClickHouse: per entity an `envio_history_<Entity>` table (every change, `envio_checkpoint_id` + `envio_change`,
  `ReplacingMergeTree` / `MergeTree`) and a view named after the entity returning the latest row per id
  (`LIMIT 1 BY`). `scripts/integrity` queries these views (`SELECT ... FROM Contract`).
- An entity is routed by `@storage(...)` (section 2.5) or by the `default` flags; one with neither is a codegen error.
  An entity stored in both is read from Postgres.
- `@storage(clickhouse: {...})` is rejected by codegen when ClickHouse is not enabled ("Entities using storages not
  enabled in config.yaml"). A Postgres-only config therefore needs its own schema file (`schema:`), which is how
  `config.local.yaml` / `schema.local.graphql` work here.
- Do not run two indexers against one ClickHouse database.

### 1.7 Preload and multichain ordering

- Preload is always on in V3 (section 3.5).
- Multichain is always unordered: each chain progresses independently.

## 2. schema.graphql

Every type is an entity. First field `id`: `ID!` (recommended), `String!`, `Int!` or `BigInt!`.

### 2.1 Scalars

| Schema | TypeScript | Notes |
|---|---|---|
| `ID!`, `String!` | `string` | |
| `Int!`, `Float!` | `number` | |
| `Boolean!` | `boolean` | `[Boolean!]!` not supported |
| `BigInt!` | `bigint` | default precision 76; `@config(precision: N)` |
| `BigDecimal!` | `BigDecimal` (`import { BigDecimal } from 'envio'`) | default (76, 32) |
| `Bytes!` | `string` or `Uint8Array` | per `bytes_type` |
| `Timestamp!` | `Date` | `[Timestamp!]!` not supported |
| `Json!` | `JSON` from `envio` | bigint must be stored as string |
| enum | string literal union | enum arrays supported |

Optional fields are `T | undefined` (never `null`). Arrays: only `[T!]!`. Entity relations are written as `<field>_id`;
`@derivedFrom` fields are virtual (GraphQL only, not readable in handlers) and require shared Postgres storage. Raw
ClickHouse tables are simpler with plain scalar columns.

### 2.2 `@index` and `@config`

- `id` and `@derivedFrom` targets are indexed automatically; `@index` on `id` is an error.
- Postgres indexes are deferred: created when the backfill finishes. A `getWhere` on any non-derived field builds the
  needed index on demand, pausing indexing while it builds (`pkg/src/LoadLayer.res:362-367`).
- `@index` has no effect on ClickHouse; use `@storage(clickhouse: {orderBy, skippingIndexes})`.
- `@config(precision: N)` on `BigInt` (also sets the ClickHouse Decimal precision; without it ClickHouse stores a
  `BigInt` as a string). `@config(precision: N, scale: M)` on `BigDecimal`.

### 2.3 `@crossChain`, `@internal`

- `@crossChain`: entity shared by all chains; only valid with `disable_default_cross_chain: true`; disables
  `envio start --chain` and automatic multi-process mode.
- `@internal`: stored and usable in handlers, hidden from GraphQL.

### 2.4 Append-only

There is no append-only or immutable directive in 3.14.1. Append-only is a convention (only `set` new ids); every
`set` still goes through the in-memory store and the Postgres history used for reorgs.

### 2.5 `@storage`

```graphql
type ShareTransfer
  @storage(
    postgres: false
    clickhouse: {
      partitionBy: "toYYYYMM(blockTimestamp)"
      orderBy: ["chainId", "token", "blockNumber"]   # entity field names; chainId allowed when per-chain
      ttl: "blockTimestamp + INTERVAL 5 YEAR"
      skippingIndexes: [{ name: "idx_from", expr: "from", type: "bloom_filter", granularity: 4 }]
    }
  ) { ... }
```

One `@storage` per entity, at least one backend enabled; `orderBy` cannot list `id`, nullable, list or derived
fields. Options apply to the `envio_history_<Entity>` table.

## 3. Handler API

Everything is imported from `envio`; there are no generated handler modules.

### 3.1 `indexer.onEvent`

```ts
indexer.onEvent(
  {
    contract: 'ClassicVault',
    event: 'Transfer',
    wildcard: false,                                  // optional
    where: ({ chain }) => ({                          // optional: indexed params and start block
      params: [{ from: '0x0000000000000000000000000000000000000000' }, { to: chain.ClassicVault.addresses }],
      block: { number: { _gte: 1_000_000 } },
    }),
    fields: { block: ['timestamp'], transaction: ['hash', 'from'] },   // optional
  },
  async ({ event, context }) => { /* ... */ },
);
```

`where` can also be a static object or return `true` / `false` (keep all / skip the chain). Event object:
`contractName`, `eventName`, `chainId`, `params` (uint -> bigint, address -> string), `block`, `transaction`
(selected fields only), `logIndex`, `srcAddress`.

### 3.2 `indexer.contractRegister`

```ts
indexer.contractRegister({ contract: 'ClmManagerFactory', event: 'ClmManagerCreated' }, async ({ event, context }) => {
  context.chain.ClmManager.add(event.params.proxy);
});
```

- Context = `{ log, chain: { id, <ContractName>: { add(address) } } }` only. Calling `add` after the promise resolved
  throws (missing `await`).
- `add` normalises the address per `address_format`; invalid addresses are skipped with a warning.
- All events of the new contract in its creation block are indexed, including earlier logs.
- Re-registering an address for the same contract is skipped ("Skipping same-contract re-registration",
  `pkg/src/FetchState.res:1497-1527`). The address store is keyed per contract, so one address can be registered under
  several contracts; each registration routes the log separately, in registration order
  (`pkg/src/FetchState.res:941-985`). Exercised in simulation by `src/handlers/factories.test.ts`.
- Registrations appear in test results as `changes[i].addresses.sets: [{address, contract}]`.

### 3.3 `indexer.onBlock`

Block handlers (`name`, `where: ({ chain }) => ({ block: { number: { _gte, _every } } })`) run after all events of
their block. Not used here. In the test indexer they are generated for every block of the processed range, so a
simulate test replays them from the chain start block.

### 3.4 Entity operations

```ts
const row = await context.Balance.get(id);              // Entity | undefined
await context.Balance.getOrThrow(id, 'message');
await context.Balance.getOrCreate({ id, balance: 0n });
await context.Balance.getWhere({ token: { _eq: token }, balance: { _gt: 0n } });
context.Balance.set({ ...row, balance });               // sync
context.Balance.deleteUnsafe(id);                       // sync
```

- Operators: `_eq`, `_gt`, `_lt`, `_gte`, `_lte`, `_in`; several are ANDed. The `index.d.ts` comment says only `id`
  and `@index` fields are queryable; the runtime accepts any non-derived field and builds the index on demand.
- `getWhere` sees uncommitted in-memory changes of the batch. Avoid it on large append-only tables during backfill.
- Returned entities are frozen: spread before changing. Per-chain mode: `get(id)` reads the handler's chain row and
  entity objects carry no `chainId`.

### 3.5 Context, logging, preload

```ts
context.chain.id;          // chain of the event
context.chain.isRealtime;  // true once all chains caught up
context.isPreload;         // true in the preload pass
context.effect(effect, input);
context.log.debug|info|warn|error(message, params?);
```

Log env: `LOG_LEVEL` (default info), `LOG_STRATEGY` (default `console-pretty`), `LOG_FILE` (default
`logs/envio.log`), `FILE_LOG_LEVEL`. `indexer.chainIds`, `indexer.chains[id].<Contract>.addresses` and
`indexer.chains[id].startBlock` are available at module top level.

Each batch runs every handler twice:

1. Preload: all handlers of the batch concurrently. Reads (`get`, `getWhere`, effects) are batched and deduplicated;
   `set` / `deleteUnsafe` are no-ops; `context.log` is ignored; exceptions only abort that event's preload.
2. Processing: sequentially in on-chain order, reading the in-memory store; writes apply; exceptions crash the
   indexer.

Consequences: no direct RPC in handlers (it would run twice, unbatched); preload sees database state, not the writes
of earlier events in the batch; do reads and effect calls first, with `Promise.all`.

### 3.6 Ordering

Per chain, items are ordered by block number, then kind (events before block handlers), then `logIndex`, then
registration index. Chains are independent.

## 4. Effects

### 4.1 `createEffect`

```ts
export const readVaultFacts = createEffect(
  {
    name: 'readVaultFacts',            // cache table name and identity
    input: { address: S.string },
    output: S.schema({ want: S.optional(S.string) }),
    rateLimit: false,                  // required: false | { calls, per: 'second' | 'minute' | <ms> }
    cache: true,                       // default false
    crossChain: false,                 // default false under disable_default_cross_chain
  },
  async ({ input, context }) => {
    context.chain.id;                  // chain-scoped effects only
    context.cache = false;             // do not cache this call
    return { want: '0x...' };
  },
);
```

A chain-scoped effect may call both kinds of effects; a cross-chain effect only cross-chain ones.

`S` (rescript-schema / Sury): `string`, `address`, `jsonString`, `boolean`, `int32`, `number`, `bigint`, `never`,
`union`, `object`, `transform`, `shape`, `refine`, `schema`, `record`, `array`, `tuple`, `merge`, `optional`,
`nullable`, `bigDecimal`, `unknown`, `assertOrThrow`, `parseOrThrow`; types `S.Schema`, `S.Output`, `S.Infer`,
`S.Input`. No bytes schema. `createEffect` turns an object-literal `input` into a schema in place, so do not share one
literal between effects.

### 4.2 Cache keys and storage

- Key = deterministic hash of the serialised input (object keys sorted, `undefined` dropped, bigint as decimal
  string). Non-plain objects (`Uint8Array`, `Date`) throw; pass hex strings and normalise address case.
- Chain-scoped effects are keyed per chain, so `chainId` need not be in the input.
- Table `"<ENVIO_PG_SCHEMA>".envio_effect_<name>` (cross-chain) or `envio_<chainId>_effect_<name>` (chain-scoped),
  columns `id text primary key`, `output json`.
- A cached row that no longer parses with the output schema is invalidated and refetched
  (`envio_effect_cache_invalidations`). Renaming an effect or changing `crossChain` starts a new table.
- Cache rows are not rolled back on reorg. Reads pinned to a block are safe except in a reorged block; reads at
  `latest` are frozen at first call.

### 4.3 Errors and batching

- Preload calls are grouped by key and run concurrently (subject to `rateLimit`); with `cache: true`, persisted keys
  are loaded in one query per effect first.
- A throwing effect rejects `context.effect`: in preload it only aborts that event's preload, in processing it crashes
  the indexer. There is no automatic retry. Nothing is cached for a throw. Pattern used here: transport errors throw,
  on-chain reverts return a status that is safe to cache.

### 4.4 Persistence across reruns and reindex

| Situation | Cache kept? |
|---|---|
| Restart / crash resume (no `-r`, compatible config) | Yes |
| `envio dev -r`, `envio start -r`, `envio local db-migrate setup/down`, first run on an empty schema | No: `DROP SCHEMA ... CASCADE`, then restore from `.envio/cache` if present |
| `envio stop` | No (drops the local Docker volumes) |

Restore (`pkg/src/PgStorage.res:1792-1910`): on every initialisation, `.envio/cache/<name>.tsv` (cross-chain) and
`.envio/cache/<chainId>/<name>.tsv` (chain-scoped) are loaded with `psql ... COPY ... FROM STDIN`. `psql` is the local
binary (using `ENVIO_PG_*`, password via `PGPASSWORD`), else `docker exec` into `envio-postgres`; with an external
Postgres and no Docker, install `psql` locally. On failure it logs "Failed to upload cache, continuing without it."

Dump (`pkg/src/PgStorage.res:2368-2440`): `POST http://localhost:${ENVIO_INDEXER_PORT:-9898}/console/syncCache`, only
in `envio dev` (returns `false` under `envio start`). Manual equivalent, one file per table:

```bash
mkdir -p .envio/cache/8453
PGPASSWORD=$ENVIO_PG_PASSWORD psql -h $ENVIO_PG_HOST -p $ENVIO_PG_PORT -U $ENVIO_PG_USER -d $ENVIO_PG_DATABASE \
  -c "COPY \"$ENVIO_PG_SCHEMA\".\"envio_8453_effect_readVaultFacts\" TO STDOUT WITH (FORMAT text, HEADER);" \
  > .envio/cache/8453/readVaultFacts.tsv
```

Directory names under `.envio/cache` must be chain ids. `.envio/` is gitignored.

## 5. Testing (`createTestIndexer`)

```ts
const indexer = createTestIndexer();
const result = await indexer.process({
  chains: {
    8453: {
      simulate: [
        factoryCreatedItem,                     // register dynamic contracts first
        {
          contract: 'ClassicVault',
          event: 'Transfer',
          srcAddress: vault,
          logIndex: 3,                          // default: auto-increment
          block: { number: 101, timestamp: 1700000012 },
          transaction: { hash: '0xabc', from: user },
          params: { from: zero, to: user, value: 10n },
        },
      ],
    },
  },
});
```

- Simulated block defaults: `number` = previous item's block, `timestamp` 0; transaction fields default to empty /
  undefined. Two items on the same `(block, logIndex)` throw.
- An item that reaches no handler (address not registered for that contract, or filtered by `where`) fails the run,
  so dynamic contracts must be registered first (helpers in `test/helpers/simulate.ts` and
  `test/independent/harness.ts`).
- Result: `{ changes: Array<{ block, chainId, eventsProcessed, addresses?: { sets }, [Entity]?: { sets?, deleted? } }> }`.
  Entities in `sets` carry no `chainId` in per-chain mode.
- Test-indexer entity ops: `get`, `getOrThrow`, `getAll`, `getWhere` (accepts `chainId`), `set` (needs `chainId`).
  State persists across `process()` calls on one instance.
- Effects run for real with an empty cache; this repo keeps RPC deterministic with `src/lib/rpcFixtures.ts`. Module
  state (viem clients) is shared across test indexers in a file.
- No reorg support in the test indexer.

## 6. Running

### 6.1 Commands

| Command | What it does |
|---|---|
| `envio codegen` | Writes `.envio/types.d.ts` and `envio-env.d.ts` from config and schema. |
| `envio dev [-r]` | Codegen, starts Docker Postgres + Hasura (+ ClickHouse if enabled) unless overridden by env, runs with the dev console, stays alive after end blocks. `-r` wipes and reindexes. |
| `envio start [-r] [--chain ID ...]` | Codegen, runs against env-configured databases; exits when all chains reach `end_block`. `--chain`: multi-process mode. |
| `envio stop` | Deletes the local Docker environment and its volumes. |
| `envio local docker up/down` | Starts / stops the Postgres + Hasura containers. |
| `envio local db-migrate up/down/setup` | Create / drop / drop + recreate the schema (`setup` wipes the effect cache, then restores `.envio/cache`). |
| `envio metrics [runtime]` | Prints `/metrics` (or `/metrics/runtime`) of the running indexer. |

Global options: `-d/--directory`, `--config <file>` (env `ENVIO_CONFIG`, default `config.yaml`). `dev` and `start`
type-check handler files with the project's `tsc` before starting: a type error refuses to start.

### 6.2 External Postgres and ClickHouse

```bash
ENVIO_API_TOKEN=...                 # HyperSync
ENVIO_PG_HOST=db.internal           # set => the CLI skips the Postgres container
ENVIO_PG_PORT=5432                  # dev fallback 5433
ENVIO_PG_USER=envio                 # dev fallback postgres
ENVIO_PG_PASSWORD=...               # fallback ENVIO_POSTGRES_PASSWORD, then "testing"
ENVIO_PG_DATABASE=envio             # dev fallback envio-dev
ENVIO_PG_SCHEMA=beefy_raw           # fallback ENVIO_PG_PUBLIC_SCHEMA, then public
ENVIO_PG_SSL_MODE=require           # dev fallback off
ENVIO_PG_MAX_CONNECTIONS=2          # >= 4 lets an all-per-chain indexer use up to 4 worker processes
ENVIO_HASURA=false                  # no Hasura (else HASURA_GRAPHQL_ENDPOINT / _ADMIN_SECRET / _ROLE)
ENVIO_CLICKHOUSE_HOST=http://ch.internal:8123   # set => the CLI pings <host>/ping, no container
ENVIO_CLICKHOUSE_DATABASE=beefy_raw_envio       # dedicated: Envio truncates / drops it on init
ENVIO_CLICKHOUSE_USERNAME=default
ENVIO_CLICKHOUSE_PASSWORD=                      # may be empty, must be set
ENVIO_INDEXER_PORT=9898             # /healthz, /metrics, /metrics/runtime, /console/*
ENVIO_TUI=false
```

Source: `pkg/src/Env.res:104-167`. Dev fallbacks apply only when `NODE_ENV !== "production"`. All four ClickHouse
vars are required when ClickHouse storage is enabled. Envio refuses to migrate a schema that already contains
non-Envio tables. UNVERIFIED: whether `envio dev` with `ENVIO_PG_HOST` set but Hasura enabled still starts a Hasura
container; set `ENVIO_HASURA=false`.

### 6.3 Switching configs

There is no env override for `storage`: use an alternate config (`--config config.local.yaml`). The stored config
differs between configs, so switching on one Postgres schema requires `-r`; use a different `ENVIO_PG_SCHEMA` per
config instead.

### 6.4 Limiting the run

- Few chains: `skip: true` on the others in an alternate config (UNVERIFIED whether toggling `skip` is
  resume-compatible; assume `-r`).
- Block range: `start_block` / `end_block` per chain, per-contract `start_block`, per-event `where.block.number._gte`.
- Per-process chains: `envio local db-migrate up` once with the full config, then
  `ENVIO_INDEXER_PORT=9899 envio start --chain 8453` per process (all entities per-chain, no `-r`).

### 6.5 Observing progress

- `curl localhost:9898/metrics` or `envio metrics`. Useful series: `envio_progress_block`,
  `envio_progress_block_time_seconds`, `envio_progress_events`, `envio_progress_latency`, `envio_progress_ready`,
  `envio_indexing_known_height`, `envio_indexing_buffer_size`, `envio_processing_seconds`, `envio_preload_seconds`,
  `envio_processing_handler_seconds`, `envio_storage_write_seconds`, `envio_processing_stalled_on_fetch_seconds`,
  `envio_processing_stalled_on_storage_write_seconds`, `envio_effect_call_total`, `envio_effect_call_seconds_total`,
  `envio_effect_cache`, `envio_effect_cache_invalidations`, `envio_effect_queue`, `envio_source_request_total`.
- `/healthz`, `/console/state` (JSON), `select * from "<schema>".envio_chains;`.
- The TUI is disabled under CI / non-TTY; force with `ENVIO_TUI=true|false`.

### 6.6 Reset and reindex

- `envio dev -r` / `envio start -r`: drop and recreate the Postgres schema (and the ClickHouse database contents),
  re-resolve `start_block: latest`, restore `.envio/cache`. `-r` cannot be combined with `--chain`.
- An incompatible config change without `-r` refuses to start and prints the changed paths. Compared: the public
  config (entities, events, storage, ...) plus per-chain start / end block, `max_reorg_depth`, static addresses and the
  contract list. Handler code changes do not require `-r`, but stored rows are not recomputed.

### 6.7 Tuning env vars read by 3.14.1

`ENVIO_IN_MEMORY_OBJECTS_TARGET` (default 100 000), `ENVIO_INDEXING_MAX_BUFFER_SIZE`, `MAX_PARTITION_SIZE` (default
5 000 addresses per partition), `ENVIO_CLIENT_FILTER_ADDRESS_THRESHOLD`, `ENVIO_PG_MAX_CONNECTIONS`,
`ENVIO_HYPERSYNC_CLIENT_TIMEOUT_MILLIS` (120 000), `ENVIO_HYPERSYNC_LOG_LEVEL`, `ENVIO_RPC_INITIAL_BLOCK_INTERVAL`,
`ENVIO_RPC_BACKOFF_MULTIPLICATIVE`, `ENVIO_RPC_ACCELERATION_ADDITIVE`, `ENVIO_RPC_INTERVAL_CEILING`,
`ENVIO_THROTTLE_CHAIN_METADATA_INTERVAL_MILLIS`, `ENVIO_THROTTLE_PRUNE_STALE_DATA_INTERVAL_MILLIS` (`pkg/src/Env.res`).
Not read: `ENVIO_MAX_PARTITION_CONCURRENCY` (max chain concurrency is hard-coded to 100), `MAX_BATCH_SIZE`,
`ENVIO_INDEXING_BLOCK_LAG`, `UNORDERED_MULTICHAIN_MODE`, `TUI_OFF`.

## 7. Version notes and gotchas

### 7.1 Relevant 3.x changes

- 3.3: `crossChain` effect option; dead simulate items fail tests.
- 3.5: deferred Postgres index creation; unlimited addresses via client-side filtering.
- 3.6: `disable_default_cross_chain`; test-indexer entity ops need `chainId`.
- 3.7: per-handler `fields`. 3.8: `@internal`, ClickHouse `skippingIndexes`. 3.10: per-chain rollbacks, ClickHouse sink
  in Rust, `bytes_type`. 3.11: `start_block: latest`.
- 3.12: `envio start --chain`; `getWhere` about 4x faster.
- 3.13: automatic multi-process indexing (up to 4 workers, needs all-per-chain entities and
  `ENVIO_PG_MAX_CONNECTIONS` >= 4); RPC source rewritten in Rust.
- 3.14.0: Rust TUI; no `tsx` dependency; handler type check on `dev` / `start`; `Json` typed as `JSON`.
- 3.14.1: optional `${RPC_URL:-}` rpc urls; ~10 s grace on stale replicas before failover; type check uses the
  project's `tsc` (TypeScript 7 works).

### 7.2 Docs vs package

- `GetWhereFilter` comment: only `id` / `@index` fields; the runtime allows any non-derived field.
- Docs say every effect cache is `envio_effect_${name}`; chain-scoped effects use `envio_<chainId>_effect_<name>`
  and `.envio/cache/<chainId>/<name>.tsv`.
- The cache dump endpoint being dev-only is not documented.
- `envio config view` prints only `version` and `storage`.

### 7.3 Gotchas

- Effect inputs must be plain values (hex strings, numbers); `S` has no bytes schema.
- With `disable_default_cross_chain: true`, `chainId` is a reserved column: do not declare it. This repo still prefixes
  ids with the chain id so they stay unique across chains in ClickHouse.
- The effect cache is not reorg-aware; ClickHouse-only tables cannot be read back; `contractRegister` has no effects.
- `envio stop` deletes local Docker volumes, including any effect cache not dumped.

## 8. RPC sync cost model

Sources: the Rust RPC source, enviodev/hyperindex at
[8ffc1f4](https://github.com/enviodev/hyperindex/tree/8ffc1f451bba34b2cf7469eaa88124ff65168bbd/packages/cli/src/evm_rpc_source)
(`mod.rs`, `enrich.rs`, `fields.rs`, `client.rs`, `inflight.rs`), `pkg/src/sources/*.res`, `pkg/src/FetchState.res`,
and live runs of this indexer.

### 8.1 Which source runs

- A HyperSync source exists only when the resolved chain config has a HyperSync endpoint; every `rpc` entry becomes an
  RPC source with its `for` role. `config.yaml` resolves 20 chains with HyperSync + RPC `fallback` and 2 (999, 1088)
  with RPC `sync`; `config.rpc.yaml` and `config.local.yaml` resolve no HyperSync source.
- `ENVIO_API_TOKEN` is only required by the HyperSync source constructors, so RPC-only configs do not need it (docs
  agree). UNVERIFIED end to end: no run of this repo without the token set.

### 8.2 Requests

| data | source | cost |
|---|---|---|
| params, `logIndex`, `srcAddress`, `block.number`, `transaction.hash`, `transaction.transactionIndex` | the log | 0 |
| `block.timestamp`, `block.hash`, other block fields | `eth_getBlockByNumber(n, false)` | 1 per distinct block with a handled event |
| `transaction.from`, `to`, `input`, `value`, gas fields, ... | `eth_getTransactionByHash` | 1 per distinct transaction with a handled event |
| receipt fields (`gasUsed`, `status`, `contractAddress`, ...) | `eth_getTransactionReceipt` | 1 per distinct transaction (not selected here) |

Confirmed by `enrich.rs` (`FetchKey`: `Block`, `Transaction`, `Receipt`) and by live metrics. Requests are not
JSON-RPC-batched (one call per HTTP POST); concurrent requests for the same block or transaction are coalesced
(`inflight.rs`, deduplication only, not a cache); at most 100 requests are in flight per RPC source by default
(`client.rs`). `log.blockTimestamp`, which most providers return in `eth_getLogs`, is not used in 3.14.1 (raised
upstream).

Measured on Base (RPC sync, 5 minutes, ~70.5k events): `eth_getBlockByNumber` + `eth_getTransactionByHash` were ~89% of
requests (65k of 73k) and ~55% of request time, and the indexer was fetch-bound. Selecting `transaction.from` roughly
doubles the per-event request count compared with block fields alone; on HyperSync every field comes in the same query.

### 8.3 Ranges, partitions, concurrency

- Range per `eth_getLogs`: `initial_block_interval` (default 10 000), + `acceleration_additive` (500) after each
  success up to `interval_ceiling` (10 000), x `backoff_multiplicative` (0.8) after an error, then wait
  `backoff_millis` (2 000). Provider "range too large" messages are parsed for the allowed size and retried with it.
  `query_timeout_millis` 20 000, `fallback_stall_timeout` = timeout / 2, `polling_interval` 1 000 at the head.
- One `eth_getLogs` stream per partition: an address set (plus the topics of its contracts' events) fetched from its
  own `latestFetchedBlock`. Up to 100 queries in flight per chain (hard-coded).
- Static addresses of a contract form one start-block group chunked by `MAX_PARTITION_SIZE` (default 5 000); static
  partitions of different contracts merge when their start blocks are within 20 000 blocks and the total stays under
  the limit. A chain with only static addresses starts with a handful of partitions.
- Dynamic registrations: one partition per contract name per group of registration blocks within 20 000 blocks.
  Registering a contract name dynamically for the first time also splits it out of shared static partitions. Dynamic
  partitions merge later as they catch up. ~800 Base contracts registered at their creation blocks gave ~150
  partitions.
- Re-registering an address already stored for the same contract creates no partition (a warning only when it would
  move the start block earlier), so listing known contracts statically makes their factory events free for
  partitioning.
- A contract with more than `ENVIO_CLIENT_FILTER_ADDRESS_THRESHOLD` addresses (default 250 000) switches to an
  address-free `eth_getLogs` on its topics, filtered client-side.

### 8.4 Tuning knobs

Per `rpc` entry: `initial_block_interval`, `backoff_multiplicative`, `acceleration_additive`, `interval_ceiling`,
`backoff_millis`, `query_timeout_millis`, `fallback_stall_timeout`, `polling_interval`, `ws`, `headers`, `for`. Env
(every chain): `ENVIO_RPC_INITIAL_BLOCK_INTERVAL`, `ENVIO_RPC_BACKOFF_MULTIPLICATIVE`,
`ENVIO_RPC_ACCELERATION_ADDITIVE`, `ENVIO_RPC_INTERVAL_CEILING`; partitioning: `MAX_PARTITION_SIZE`,
`ENVIO_CLIENT_FILTER_ADDRESS_THRESHOLD`; buffering: `ENVIO_INDEXING_MAX_BUFFER_SIZE`; processes: `ENVIO_PG_MAX_CONNECTIONS`
(default 2 = one process for all chains; >= 4 splits into min(chains, connections / 2, 4) workers, chains dealt in config order). No knob caps the number of
partitions or the per-chain concurrency. rpc.beefy.com (erpc) rejects `eth_getLogs` ranges above 30 000 blocks
(`ErrGetLogsExceededMaxAllowedRange`) and some of its upstreams above 1 000, so the 10 000 default sits inside the
limit.
