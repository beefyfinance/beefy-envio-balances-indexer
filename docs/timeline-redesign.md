# Timeline

**Status: target design.** Current state and the steps to get here: [timeline-migration.md](timeline-migration.md).
How the design was arrived at, and the measurements behind it: [annexes](#annex-a-the-stamping-pipeline).

The timeline is every action of an account on Beefy products (balance changes, mints and burns, CLM deposits and
withdrawals, reward claims), each with its USD value, served by the API at `/v1/users/{address}/timeline`.

## Principles

1. **The indexer writes the timeline.** One Envio entity, `TimelineEvent`, sorted by account; ClickHouse reads Envio's
   table in place, with no copy.
2. **No pricing at read time.** An event older than a watermark (about a day) has a final stored price, computed in
   the background from the analytics price tables once a day's prices are complete. A newer event carries the latest
   Beefy API price the indexer had when it wrote it, or, when it has none (indexed during a sync, API down), a
   provisional stored price from the same background job. The read is a lookup.
3. **Every price newer than the watermark is temporary.** It is replaced by the final stored price when the watermark
   passes the event.
4. **Versions side by side.** A reindex builds a complete new version next to the active one; the API switches
   atomically; old versions are dropped by a job that is safe to rerun. One database of ours per environment;
   per-version objects carry the version in their name.
5. **The API only runs a query.** All logic is in the indexer handlers and one ClickHouse view; limits are the API
   user's settings profile. ClickHouse does as little as possible per request: one lookup, results in a binary format
   (`ArrowStream`) decoded by the API, since API servers are easy to add and ClickHouse servers are not.

## Objects

### In Envio's database `envio_<env>_N` (written by the indexer)

| Object | Role |
|---|---|
| `TimelineEvent` entity (history table `envio_history_TimelineEvent`) | one row per user event, all kinds, sorted by account (`orderBy: ["account", "chainId", "blockNumber", "logIndex"]`), with the indexer's price for recent events |
| `Contract`, `ContractLink`, `Token` entities | product facts; `Contract` also carries the facts the indexer needs to price an event (`productAddress`, `priceDecimals`) |

### Ours, in `beefy_indexer_<env>` (one database per environment)

Per version N, suffixed with the version:

| Object | Type | Role |
|---|---|---|
| `event_price_<N>` | table, `ReplacingMergeTree(version)`, sorted by account | the stored price of each event: final below the watermark, provisional above it for events the indexer did not price |
| `price_watermark_<N>` | table | the watermark, when it last moved, and Envio's frontier per chain at that move |

Shared, never renamed or dropped (the API only reads the three views):

| Object | Type | Role |
|---|---|---|
| `deployments` | table | one row per version: Envio database, state, timestamps, cleanup steps done |
| `user_timeline_api(account)` | parameterized view | the timeline query; rebuilt to name the active version's tables and Envio database |
| `product_contracts_api` | view | contracts that are Beefy products (the API's address filter) |
| `api_status` | view | active version and watermark age, for cache keys and `/health` |

No materialized views, no dictionary.

### Read, not owned

| Source | Read by | Used for |
|---|---|---|
| `envio_<env>_N.envio_history_TimelineEvent`, `envio_chains` | API view, reprice job | events, Envio's committed checkpoint per chain |
| `envio_<env>_N.envio_history_{Contract, ContractLink, Token}` | reprice job, `product_contracts_api` | product facts |
| `analytics.token` | reprice job | (chain, address) to price `asset_id`; classic vault and CLM share tokens are assets |
| `analytics.asset_price_5m` | reprice job | 5-minute prices (the 1h and 1d tables are aggregates of it: [Annex C](#annex-c-alternatives-for-recent-prices)) |
| Beefy API `/mootokenprices`, `/lps`, `/vaults`, `/cow-vaults` | indexer | latest share prices |

```
 Beefy API (latest prices) ──▶ indexer handlers ──▶ envio_<env>_N.TimelineEvent (sorted by account, price if recent)
                                                    envio_<env>_N.Contract / ContractLink / Token
                                                              │                    │
 analytics.asset_price_5m ▶ reprice job (worker) ◀────────────┴── events + facts ──┘
                                     │                                             │
                                     ▼                                             ▼
                              event_price_<N> ──── stored price ───▶ beefy_indexer_<env>.user_timeline_api(account)
                                                                                   │
                                                                     API (readonly, cached)
```

## TimelineEvent (indexer)

| Kind | Written by | Account |
|---|---|---|
| `BALANCE` | share token `Transfer`, boost stake and withdraw | each side of the balance change |
| `MINT`, `BURN` | share token `Transfer` from or to the zero address | the receiver, the sender |
| `CLM_DEPOSIT`, `CLM_WITHDRAW` | CLM manager `Deposit`, `Withdraw` | the user |
| `CLAIM` | reward pool and boost `RewardPaid` | the user |

Columns: `kind`, `contract`, `source`, `delta`, `shares_after`, `amount0`, `amount1`, `reward_token`, `reward_amount`,
transaction and block fields, and the indexer price columns ([Indexer prices](#indexer-prices)). Id
`chainId-trxHash-logIndex-account-kind`, stable across reindexes. `chainId` is added by Envio (it cannot be declared),
so `chain_id` is the last data column.

**Zap attribution** (`apps/indexer/src/lib/timeline.ts`). A router that receives freshly minted shares and forwards
the same value at a later log gives the receiver a MINT at the forwarding log; an account that receives a value and
burns the same value later gives each sender of that value a BURN at its own transfer log. The user gets its own row;
the router keeps its MINT or BURN; no row is ever updated. The earlier legs of the transaction are kept in `ShareFlow`
(Postgres, one row per share token and chain, reset when the transaction changes): one get per share transfer, one set
per mint or transfer between two accounts.

**Rollbacks.** Nothing to do on our side. Envio physically deletes rolled-back rows, and reads only take rows at or
below Envio's committed checkpoint per chain (`envio_chains`), so uncommitted rows are never shown.

**Invariant: a TimelineEvent is never deleted by a handler.** Envio writes a `DELETE` history row with every data
column empty (`account = ''`), so a read filtered on `account` would never see it and the previous row would stay
visible.

## Indexer prices

### Source

The Beefy API serves the latest share price of every product, the same series as the `api` source of
`analytics.asset_price_5m`.

| Product | Price | Address mapping |
|---|---|---|
| Classic vault | `/mootokenprices`: chain → moo token symbol → price | `/vaults`: `earnedToken` → `earnContractAddress` |
| CLM manager | `/lps`: vault id → price | `/cow-vaults`: `id` → `earnContractAddress` |
| Boost, reward pool | the price of the product it stakes | `Contract.productAddress` |

### Price cache

A module of `apps/indexer` keeps, per chain, a map from product address to `{ price, fetchedAt }` in memory:

- prices (`/mootokenprices`, `/lps`) are refreshed every minute and the address mappings (`/vaults`, `/cow-vaults`)
  every 10 minutes, in the background; a failed fetch keeps the previous map;
- handlers read the map synchronously and never wait for the API; a handler that runs before the first fetch completes
  finds no price;
- it is disabled in RPC fixture mode, so tests stay deterministic.

Not an Envio effect: effects cache by input, and this value depends on when it is read.

### Which events get a price

An event gets the cached price only when, at the time the handler runs:

- the event is recent: `now - block timestamp <= 10 min` (an event indexed during a historical sync gets none);
- the price is recent: `now - fetchedAt <= 15 min` (a stuck refresh stops pricing instead of spreading an old price);
- the contract's price facts are known (`Contract.productAddress` and `priceDecimals` set).

These columns are not deterministic: a rollback replay or a reindex can write another value. That is acceptable
because the value is always replaced ([Replacement](#replacement)).

### Columns

On `TimelineEvent` (ClickHouse only, so no handler reads them back):

| Column | Value |
|---|---|
| `headPrice` | the share price in USD, in the [unit](#prices) of stored prices; unset when not priced |
| `headPriceAt` | `fetchedAt` of that price |
| `headProduct` | the product the price belongs to (the contract itself, or what a boost or reward pool stakes) |
| `headDecimals` | the decimals the price is per (want decimals for a classic vault) |

With them the read computes `usd_delta` and `usd_after` without joining the product facts.

### Price facts on `Contract`

Handlers can read `Contract` and `Token` (Postgres), not `ContractLink` (ClickHouse only). `Contract` carries, set
where its links are read (`apps/indexer/src/lib/registry.ts`):

- `productAddress`: the vault or CLM a boost or reward pool stakes (`BOOST_STAKED`, `REWARD_POOL_STAKED`); the contract
  itself for a vault or CLM manager;
- `priceDecimals`: want decimals for a classic vault (from `VAULT_WANT` and the want's `Token`), share decimals
  otherwise.

Same rule as `productFactsCtes` (`packages/clickhouse/src/events.ts`), which stays the source of truth for stored
rows.

### Replacement

1. **A stored row always wins**: the read only looks at the indexer columns when the event has no stored row.
2. **Every row gets a final stored row** when the watermark passes it ([Stored prices](#stored-prices)), so an event
   keeps its indexer price only while it is younger than the watermark: about a day plus the `advance` period.
3. If `advance` stops, the alert on a watermark older than 2 days fires.

### Events with no indexer price

An event younger than the watermark gets no indexer price:

- when it was indexed during a sync: after a reindex, every event of the last day (the part of history the watermark
  has not reached) is in this case;
- while the Beefy API is down, or does not list a product yet;
- for a contract whose price facts are not read yet.

The reprice job gives these events a provisional stored row on each run ([Provisional rows](#provisional-rows)), so
they show `PENDING` only until the next `advance` (15 min), and a version is never switched to while any remain
([Lifecycle](#lifecycle)).

## Read path

`user_timeline_api(account)`:

1. **Events.** From `envio_history_TimelineEvent`, filtered by `account` first (sort key), then
   `envio_checkpoint_id <= committed checkpoint of the row's chain`, then the latest row per id
   (`ORDER BY id, envio_checkpoint_id DESC LIMIT 1 BY id`), keeping `envio_change = 'SET'`. This is what Envio's own
   entity views do, with the account filter applied before the deduplication instead of after it.
2. **Price**, per event:
   1. its `event_price_<N>` row, if it has one (final or provisional);
   2. otherwise its indexer price, if set: flag `PROVISIONAL`, `price_source = 'indexer'`, `price_resolution = 'latest'`,
      `price_before_at = headPriceAt`;
   3. otherwise flag `PENDING`, USD values 0.

No product facts join and no price table is read at request time. Heavy queries are stopped by the API user's settings
profile (`max_rows_to_read`, `max_execution_time`); the API returns the error.

A stored row whose event no longer exists in Envio (a rollback deep enough to cross the watermark) is never shown: the
read starts from Envio's events and only looks prices up.

## Stored prices

### event_price_<N>

One row per event below the watermark (final), and per event above it that the indexer did not price
(provisional): `account`, `chain_id`, `event_id`, `timestamp`, `product_address`,
`product_kind`, `contract_kind`, `decimals`, `share_to_usd`, `price_flag`, `price_source`, `price_resolution`,
`price_before_at`, `price_after_at`, `usd_delta`, `usd_after`, `facts_complete`, `version`. Sorted by
`(account, timestamp, event_id)`, small granules, partitioned by month so the reprice job writes and rereads only the
months it prices.

**Every row below the watermark is stored**, whatever its flag (`MISSING` and `EXTRAPOLATED` included) and whether
its product facts are complete. Nothing is priced at read time, so a row left out would show its indexer price, or
`PENDING`, forever.

### Reprice job (worker)

When the watermark advances from `W0` to `W1`, the job reads the events with `W0 <= timestamp < W1` from Envio, joins
the product facts from Envio's tables, prices them ([Prices](#prices)) and inserts them into `event_price_<N>`.
Reading by time is a scan of Envio's table, which is sorted by account; it runs in the background, once per watermark
move, in chunks of at most 7 days (the first advance starts at the oldest event), writing the watermark after each
chunk.

**Late rows.** A row Envio commits after the watermark passed its timestamp (a chain still catching up) would otherwise
keep its indexer price, or stay `PENDING`, forever. The watermark row keeps Envio's frontier per chain at each move;
the next advance first prices the rows committed since then whose timestamp is below the watermark, in bounded
statements ([Bounded statements](#prices)), and skips the step entirely when the frontier has not moved.

**Retry window.** Each advance also reprices the rows of `[W - 7 days, W)` that have no stored row (Envio reuses
checkpoint ids after a rollback, ids are frontier + 1, so replayed rows can escape the late-row step) or whose stored
row is not final (flag other than `OK` or `STALE`, or incomplete facts), and stores them again when the result changed.
A late mapping, want link or coarse price is so picked up within a week; older ones need `reprice` or `rewind`, as for
any backfill.

### Provisional rows

Each advance, after moving the watermark `W`, prices the events with `timestamp >= W` that have no indexer price
(`headPrice` unset), with the same SQL and the prices known so far (so mostly `EXTRAPOLATED`, or `OK` once a later
price exists), and
stores those whose result changed since the last run. A late price snaps back within one run. When the watermark
passes them, the normal step stores their final row with a higher version, which replaces the provisional one.

The scan is by time over the last day of Envio's table, plus the provisional rows already stored for the comparison:
small next to the watermark step, and empty in normal operation apart from API outages and new products.

**Concurrent moves.** `advance` remembers the watermark row's `moved_at` when it starts and writes each chunk's
watermark only if no one moved it since (compare-and-set); otherwise it stops and reports `superseded`, so a `rewind`
during an advance is never lost. A first advance with no committed event writes no watermark.

**Watermark rule:** `W1 = min(now - 1 day, freshest price of each required source - max price gap)`, required sources
from `CLICKHOUSE_WATERMARK_PRICE_SOURCES` (default `api,beefy_db`), looked up over the last 30 days (a source with no
price in that time stops the watermark). If a source stops, the watermark stops too and the newer events keep their
indexer price or provisional row until the prices arrive: nothing is stored as final with a stale price because of an
outage.

**Repricing history** (an upstream gap filled later, a new price source, a facts fix):

- `rewind <time>` moves the watermark back. The next advance reprices the rows above it as provisional rows (they
  have no indexer price), then stores them as final again as the watermark catches up. For days or weeks of rows.
- `reprice <from> <to>` reprices a range in place without moving the watermark: new rows with a higher version. For
  large ranges.

Repricing writes a second copy of the rows until ClickHouse merges them; `FINAL` hides the duplicates.

## Prices

How the reprice job prices an event. The SQL is `pricedEventsCtes` (`packages/clickhouse/src/pricing.ts`); it runs
only in the background, where planning time does not matter.

**Source.** `analytics.token` maps (chain, address) to one `asset_id`. A classic vault's or CLM's share token maps to
the asset of its share price (source `api` since 2025-12-09, `beefy_db` back to 2021), never to its want's. Product
facts (which product a contract belongs to, its decimals) come from the indexer's entities, not `analytics.product`.

**Unit.** A classic vault's price is per 10^(want decimals) share units, a CLM's per 10^(share decimals). The indexer
price uses the same unit (same series).

**Interpolation.** From `analytics.asset_price_5m` only. Linear between the nearest price at or before the event and
the nearest at or after it, each looked up within 48 h of the event:

| Prices found | Flag |
|---|---|
| both sides, at most 6 h apart | `OK` |
| both sides, further apart | `STALE` |
| one side only | `EXTRAPOLATED` (carried flat) |
| none | `MISSING` |

`price_resolution` is `5m` for stored rows (`latest` for indexer prices). Prices are only looked up within that window,
so an event's price never depends on the other events priced in the same statement.

**Filter.** The price table is filtered by the events' assets and days on its own key columns (`asset_id`,
`toDate(date_time)`), so partitions and granules are pruned.

**Bounded statements.** Each statement prices at most a configured number of events (the time ranges are split by
event counts), with per-query memory and time limits set by the worker, so a statement's cost depends on the chunk,
never on the length of history or the number of chains.

**Deterministic inputs.** Every pick is deterministic, so repricing a row gives the same value: the want link is the
latest by `since_block` (then the larger address), a token maps to its smallest `asset_id`, and two 5-minute prices at
the same time resolve by the larger `price_source`.

**Flags.**

| Flag | Where | Meaning |
|---|---|---|
| `OK` | stored | interpolated between two prices |
| `STALE` | stored | interpolated between prices more than 6 h apart |
| `EXTRAPOLATED` | stored | a price on one side only, carried flat |
| `MISSING` | stored | no price within reach; USD values 0 |
| `PROVISIONAL` | read | the indexer's latest price (`price_source = 'indexer'`, `price_resolution = 'latest'`) |
| `PENDING` | read | younger than the last advance and not priced by the indexer; USD values 0 |

## Versions

### Lifecycle

`building → ready → active → retired → dropped`, recorded in `deployments`.

- **building**: Envio indexes into `envio_<env>_N` (`deploy` requires exactly `<CLICKHOUSE_ENVIO_DATABASE_PREFIX><N>`);
  `deploy` creates `event_price_<N>` and `price_watermark_<N>`, and the reprice job fills them up to the watermark.
- **ready**: Envio has reached the chain head, the watermark is current, and event counts per chain are close to the
  active version's, and every event older than 15 minutes has a price (a stored row or an indexer price: no
  `PENDING` beyond the last advance). `readiness <N>` reports what it can; `ready <N>` is set by hand (open question
  4); `switch` refuses a version with such `PENDING` events unless forced.
- **active**: `user_timeline_api` points at this version.
- **retired**: replaced; kept for a grace period so a switch can be undone.
- **dropped**: the version's `_<N>` tables, then the Envio database are dropped (each step recorded). Envio's Postgres
  schema is not dropped.

The worker loops over every version not yet dropped: watermark, reprice, checks. Several versions run side by side.
During a reindex two Envio processes run, so RPC and Beefy API calls double for that time.

### Switch

The new version is recorded `active` and the previous one `retired` first; then each API view is built under
`<name>_next` and swapped in with `EXCHANGE TABLES` (atomic, and unlike `CREATE OR REPLACE` with a definer it leaves no
dependency records behind). Recording the states first means a switch that dies half way leaves no version that cleanup
could drop under the API, and rerunning it converges. Undoing it is the same switch pointing back. The API puts the
active version (from `api_status`) in its cache keys, so a switch never serves timelines cached from the old version.

### Cleanup

A job drops versions retired for longer than the grace period, one step at a time, recording each step in
`deployments`; every step can be rerun. Before dropping, it re-reads the version's state and skips a version whose
tables or Envio database any view of ours still names (reported as `inUse`). It only drops an Envio database named
exactly `<prefix><N>`, and never `system`, `default`, `information_schema`, our database or a price table's database
(reported as `refused`). An `envio_<env>_*` database or a `_<N>` table that is not in `deployments` is reported and
never dropped automatically. The worker needs the right to drop `envio_<env>_*`.

## Access

| User | Grants |
|---|---|
| API | `SELECT` on the three API views only; readonly profile with row, byte, time and memory limits |
| worker | create and drop tables and views in `beefy_indexer_<env>`, `SELECT` and drop on `envio_<env>_*`, `SELECT` on the `analytics` price tables |
| indexer | read and write `envio_<env>_*`; outbound HTTPS to `api.beefy.finance` |

The views run as the worker (`SQL SECURITY DEFINER`, `CLICKHOUSE_DEFINER`), so the API needs no grant on Envio's
databases or the version tables.

## Operations

`packages/clickhouse/src/cli.ts`:

| Command | Does |
|---|---|
| `migrate` | create `deployments` and the API views |
| `access [envioPrefix]` | create the users, profiles and grants (needs an administrator) |
| `deploy <N> <envioDatabase>` | create version N's tables, register it as `building` |
| `list` | list versions and their state |
| `advance` | move every version's watermark and store the prices (the worker runs it on a timer) |
| `readiness <N>`, `ready <N>` | check, then mark version N ready |
| `switch <N> [--force]` | point the API at version N, retire the previous one |
| `rewind <N> <time>` | move version N's watermark back |
| `reprice <N> <from> <to>` | reprice a range in place |
| `cleanup [--grace-hours H]` | drop retired versions past the grace period (default 48 h) |
| `seed-synthetic <envioDatabase> [events] [--products] [--accounts] [--days]` | fill a load-test setup |

Configuration: each app's `src/lib/config.ts` is the only reader of the environment; it validates everything at
startup and the process exits on any invalid value (variables and defaults in each app's `.env.example`). Main ones:
`CLICKHOUSE_ENVIO_DATABASE_PREFIX` (required for the worker and CLI, e.g. `envio_dev_mrt_`), the 5-minute price table,
`CLICKHOUSE_TOKEN_TABLE`, `CLICKHOUSE_WATERMARK_PRICE_SOURCES`, `CLICKHOUSE_DEFINER` (the worker warns when unset: the
views then run as the caller), and the reprice bounds `REPRICE_MAX_EVENTS` (500k events per statement),
`REPRICE_MAX_MEMORY_MB` (4096), `REPRICE_MAX_EXECUTION_SECONDS` (600), `REPRICE_RETRY_DAYS`. Worker jobs: `advance`
every 15 min, `cleanup` daily (48 h grace), `version-status` every 5 min.

Alert on: watermark older than 2 days, a version stuck in `building`, no active version, an unknown database, a refused
drop, a high share of the last hour's events without an indexer price (reported by `version-status`; the sign of an
indexer price cache that stopped), `PENDING` events older than 30 minutes (provisional rows not written). Before a
version's first advance it has no watermark: `/health` reports `pending`, not `degraded`.

SQL text: every statement is built with the `sql` tagged template (`packages/clickhouse/src/sql.ts`; `pgSql` in
`apps/indexer/scripts/lib/pgSql.ts` for the psql checks), and the clients accept nothing else.

- Values go in only as typed parameters, `param('String', account)` rendering `{p_0:String}`. ClickHouse parses
  them server side.
- Names go in only through `ident` and `qualified`, which apply a strict pattern and add backticks.
- Integers that cannot be parameters (view bodies, settings profiles) go through `int`.
- Constants of our own code go through `raw` or `literal`. Both accept a string literal type only.

A plain string, number or template interpolated into the tag fails to compile, and also throws at run time when a
cast hides it. The `beefy/no-untagged-sql` oxlint rule (`tools/oxlint-plugin-beefy`, run by `pnpm test`) catches the
cases types cannot see:
- SQL-looking text outside the tag;
- concatenation or `.join` of SQL;
- string building inside the tag or passed to `raw`.

## Open questions

1. **Envio's committed checkpoint on rollback.** The read relies on Envio deleting rolled-back rows and on
   `envio_chains` giving the committed checkpoint per chain, as Envio's own entity views do. To confirm on a real
   rollback: does a reader filtering on that checkpoint ever see a row Envio is about to delete?
2. **Switch and cleanup.** How close the event counts must be before a switch, and how long the grace period is.
3. **Required price sources** for the watermark rule (`api` and `beefy_db` today).
4. **Readiness.** Checking that Envio reached the chain head is not automated (`ready <N>` is set by hand).
5. **Indexer price unit**: confirm on a vault whose want does not have 18 decimals that the API price matches the
   analytics unit.
6. **Products the API does not list** (retired long ago, private): priced by provisional rows from the analytics
   tables, which may lag (`beefy_db` prices arrive about 19 minutes late). Fine?
7. **Claims**: USD values are computed for balance rows only. `/prices` has the reward token prices if claims should
   get one.

## Decisions

| Decision | Chosen | Over | Why |
|---|---|---|---|
| Timeline shape | written by the indexer (`TimelineEvent`), read in place | copying Envio's rows with SQL views | [Annex A](#annex-a-the-stamping-pipeline) |
| Rollbacks | Envio's deletes and committed checkpoint | reconcile views comparing copies | [Annex A](#annex-a-the-stamping-pipeline) |
| Zap attribution | indexer handler, a separate row for the user | SQL view over a recent window; updating the router's row | no row is ever updated |
| Version objects | one database, version in the table names | one database per version | simpler grants and cleanup |
| Switch | build `_next`, `EXCHANGE TABLES` | `CREATE OR REPLACE VIEW` | [Switch](#switch) |
| Product facts | Envio's tables, joined by the reprice job; mirrored on `Contract` for the indexer price | a copy (dictionary, facts table), `analytics.product` | [Annex D](#annex-d-product-facts-source) |
| USD values below the watermark | stored by the reprice job, every row | stamping every row as it arrives; storing only final rows | [Annex A](#annex-a-the-stamping-pipeline), [Annex B](#annex-b-read-time-pricing) |
| USD values above the watermark | the indexer's latest Beefy API price, else a provisional stored row from the reprice job | read-time pricing; a materialized view on Envio's table | [Annex B](#annex-b-read-time-pricing), [Annex C](#annex-c-alternatives-for-recent-prices) |
| When to reprice history | watermark, 7-day retry window, explicit `rewind` / `reprice` | checksums to detect changed months | simpler, explicit |
| Reindex | new version side by side, atomic switch | reindex in place | no downtime, undo by switching back |
| Price tables | `analytics.asset_price_5m` through `analytics.token` | `dbt.int_*`; a 5m / 1h / 1d cascade | `dbt.int_*` are internal and may change; the 1h and 1d tables add no coverage |
| Result format | `ArrowStream`, decoded by the API | `JSONEachRow` | JSON is most of ClickHouse's work on a read ([Annex B](#annex-b-read-time-pricing)); API servers scale, ClickHouse does not |
| Logic in the API | none; limits in the settings profile | caps in application code | one place for the logic |
| SQL construction | `sql` tag with typed parameters and checked names, plus a lint rule | string templates with escaping helpers; a query builder | an injection is a type error; no maintained ClickHouse builder exists |

---

## Annex A: the stamping pipeline

The design this one replaces (described in [serving-architecture.md](serving-architecture.md)) was validated end to
end on dev_mrt (Arbitrum, 2026-10-28), but it was about 22 ClickHouse objects doing two jobs:

- **Copy Envio's rows** into `user_timeline`, re-sorted by account and reshaped into one timeline format (6 insert-time
  views), then repair that copy, because Envio deletes rows on a rollback and insert-time views cannot see deletes
  (6 reconcile views, plus `mv_routed_markers` for zap attribution).
- **Keep a stored copy of the USD values up to date** while its inputs keep changing: prices get corrected, arrive
  late or have gaps filled afterwards (upstream gap 2026-07-20 to 2026-08-09), and a contract's decimals and product
  mapping can land after its first events. Each change needed its own rewrite rule (`stamp_queue`, `mv_stamp_recent`,
  `mv_stamp_repair`, `flagged_rows`, row-level change checks). Missing one was a silent bug: rows priced before a want
  link was known kept 18 decimals (fixed 2026-10-28), and an OK row older than 3 hours was never repriced.

The copy is not needed: we choose the sort key of Envio's ClickHouse tables, and Envio already handles rollbacks.

Direct reads, measured on `envio_dev_mrt_4` (Arbitrum):

| Read | Time |
|---|---|
| one account's rows in Envio's history table, filtered by account before deduplication | 5 ms (32k of 167k rows) |
| the same through Envio's entity view (deduplication before the filter: full scan) | 150 ms |
| product facts joined live from `Contract`, `ContractLink`, `Token` | 33 ms to run |

**Validation of this design against it** (version 5, Arbitrum slice from 2025-11-01, 298k events, 2026-10-29): on the
five largest accounts (5k to 118k events), the same events one to one with the same deltas; every price both mark OK
within 1%. The new design prices 684 more events OK and 1,184 fewer: CLM shares (mostly USDC-USDT) whose asset exists in
`analytics.asset` with no price at all, where `dbt` had `beefy_db` prices; a gap in the analytics tables. The reprice
job stored a year of history in 36 s (52 statements).

## Annex B: read-time pricing

A first version of this design stored only final prices below the watermark and priced everything else at read time:
the last day, plus older rows whose price was not final. Measured on dev_mrt (version 5, 2026-10-29):

- **Planning dominates.** An empty account cost 377 ms of server time; `EXPLAIN` alone took 318 ms, while the pieces
  ran in about 35 ms together. ClickHouse inlines each CTE at every reference, so the live product facts join (56 ms to
  plan once) and the pricing SQL (three price tables, window functions, ASOF join, resolution ranking) were planned
  several times per request.
- **No plan cache.** Query parameters are substituted before analysis, the MySQL and Postgres protocols' prepared
  statements only keep the text, and the query cache stores results per exact query (per account). Every request pays
  the planning, as CPU on the server.
- **It does not scale with concurrency**: 64 distinct accounts, 32 at a time, ran at 9 requests/s with a median of 3.4 s.
- **Old unpriced rows cost every read**: the 118k-event account had 7k `MISSING` / `EXTRAPOLATED` rows below the
  watermark (real price gaps: vault share prices start 2025-12-09, a 20-day hole in July) over 84 products and 150
  days, priced again on each request: 62M price rows read (asset and day sets are independent, so their cross product
  is scanned).
- **A day filter that did not prune**: filtering `toStartOfDay(start)` over the union of the price tables read the whole
  `asset_price_1d` (a function over a Date cast to DateTime defeats partition and key pruning). Fixed by filtering each
  table on its own key column, kept in the reprice SQL.

| `user_timeline_api` shape | Empty account | 8k–10k events | 118k events | 64 accounts, 32 at a time |
|---|---|---|---|---|
| events + facts join + read-time pricing | 377 ms | ~300 ms | 1,498 ms | 9 req/s, p50 3.4 s |
| events + stored prices only (this design) | ~10 ms to plan | not measured | not measured | 112 req/s, p50 0.21 s, not saturated |

**Result format.** Server time to return the same 10k stored rows (dev_mrt): no output 6.8 ms, `JSONEachRow` 22.5 ms
(6.4 MB), `TabSeparated` / `RowBinary` 16 ms, `Native` 5.3 ms, `ArrowStream` 5.0 ms (0.6 MB). JSON serialization was
most of the work.

## Annex C: alternatives for recent prices

Measured or considered on dev_mrt (2026-10-29) for the events younger than the watermark:

| Option | Result | Why not |
|---|---|---|
| Product facts in a table instead of the live join | 83 ms empty, 2× throughput | still plans the pricing SQL |
| Plus asset and day sets computed once | 71 ms empty, 23 req/s at 8 at a time | same |
| Plus materialized CTEs (`enable_materialized_cte`) | about 20% on real accounts, nothing on empty ones | experimental, small gain |
| 5-minute-only read-time lookup (two ASOF joins) | 32 ms empty, 68 req/s at 32 at a time; 210 ms and 17 req/s with the live facts join | needs a facts table; still logic at read time |
| Materialized view pricing at write time into a provisional table | not built | two objects per version; an MV error fails Envio's inserts and adds latency to them |
| A worker pricing the last day every ~30 s | not built | events wait up to 30 s for a price; more writes |
| Indexer writes the Beefy API's latest price (chosen) | no read-time pricing: ~10 ms to plan | the indexer depends on the API |

**The Beefy API as a source** (2026-10-29): `/mootokenprices` covers all 352 Arbitrum vaults, retired ones included,
and `/lps` all 144 Arbitrum CLMs. On two vaults the API price matched `analytics.asset_price_5m`'s `api` rows to the
fifth significant digit. At the time, the newest 5-minute price was about 4 minutes old for `api` assets and 19 minutes
for `beefy_db` ones. Among the 111 assets of products active that week, none had recent 1h prices without 5-minute
ones.

**One price table.** `asset_price_5m`, `asset_price_1h` and `asset_price_1d` cover the same 11,812 assets, and no daily
series starts before its 5-minute one: the coarse tables are aggregates and add no coverage. Their only effect in the
first version was a longer reach over gaps (48 h for daily bars), which the 5-minute lookup now has directly.

**Facts written by the indexer on each event** were rejected: facts read late or corrected later would be frozen on
the events until a reindex. Only the price facts are mirrored on `Contract`, for the temporary indexer price.

## Annex D: product facts source

The events come from the indexer, so their product mapping does too. `analytics.product` is built from the Beefy API,
and `analytics.missing_products_in_envio` (2,318 rows) shows the two lists differ. `analytics.token` agrees with the
indexer on want decimals (211 of 211 vaults on dev_mrt) and can serve as a cross-check. On dev_mrt, 211 of 213 vaults
and 121 of 134 CLMs map to a price asset.
