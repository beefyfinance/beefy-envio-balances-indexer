# Serving architecture (public API)

How the public API answers user queries on a small server, behind Cloudflare, under aggressive query patterns. It builds
on [architecture.md](architecture.md) (what the indexer records) and decides how that data reaches users.

Numbers here are **starting values to validate with the load test at the end**, not measurements. Measured figures are
marked as such.

## Scope and constraints

- **One endpoint for now: the user timeline.** Every priced event of every Beefy product a user touched, newest first,
  in one response: no pagination, no parameters. The frontend computes APY, PnL and the rest from it. Breaking changes against the existing CLM API timeline and the
  databarn v1 timeline are allowed.
- **Public and unauthenticated**, so the worst case is a scraper enumerating addresses, not a polite dashboard.
- **Cloudflare is a cache we cannot configure.** It caches JSON and respects the `Cache-Control` we send; that is all we
  can rely on. No custom cache keys, no Transform Rules, no rate-limit or WAF rules, no purges. Every defence beyond
  `Cache-Control` lives in the origin.
- **One small stateless origin** (Hono, Node) and a ClickHouse shared with other teams. Origin load must not scale with
  the number of users, and ClickHouse load must not scale with the number of requests.
- Freshness of tens of seconds is fine (prices are 15 minute data anyway).

## The shape

```
 client ──► Cloudflare ──► origin (Hono, 1..n small instances) ──► ClickHouse (envio_analytics)
            Cache-Control     canonicalize · rate limit · in-process     account-first tables,
            only              cache · single-flight · load shedding      point range read
```

Rules everything follows from:

1. **A request never scans raw data.** It reads a few rows from a table whose sort key starts with the account.
2. **Cost per request is bounded by construction**: one path parameter, nothing else; one point read of one account's
   already priced rows. No join and no price lookup at request time; the only computation is grouping that
   account's rows by transaction × product (balances are stored on the rows, so there is no running sum).
3. **Most requests are answered by something cheaper than ClickHouse** (Cloudflare, then the origin's memory).
4. **Identical work is done once** (single-flight, jittered TTLs).
5. **Overload degrades to stale data or a clean `429`/`503`, never to a slow ClickHouse.**

## The endpoint

`GET /v1/users/{address}/timeline`

- `address`: any-case hex address, lowercased by the origin. **No query parameters, no cursor, no limit**: the whole
  history in one response, which is what makes it one cache entry per user.
- One response item per **transaction × product**: the events of one transaction on one product are merged and listed in
  `actions[]`, as the CLM API does today.
- Newest first. Compressed by Cloudflare and the origin (brotli or gzip).

Item shape (one shape for classic vaults and CLMs; field names to be settled against a databarn v1 sample, which I do not
have yet):

| field | meaning |
|---|---|
| `type` | `classic` or `clm` |
| `datetime`, `block_number`, `transaction_hash` | when and where |
| `chain` (key), `chain_id` | |
| `product_address` | vault or CLM manager address, lower case (a `product_key` and `display_name` are not in the response yet: they need the Beefy API or the price table's `beefy_key`) |
| `actions[]` | `deposit`, `withdraw`, `transfer_in`, `transfer_out`, `stake`, `unstake`, `claim`, ... |
| `share_balance`, `share_diff` | total across the vault/manager, boosts and reward pools |
| `contracts[]` | per contract (vault or manager, each reward pool, each boost): address, kind, balance, diff |
| `share_to_underlying` / `underlying0`, `underlying1` (CLM) | amounts per share or per token, balances and diffs |
| `prices` | USD price of each underlying token (and of the share) used, with the timestamp of that price |
| `usd_balance`, `usd_diff` | value after and change |
| `claims[]` | reward token, amount, USD price |

Amounts are decimal strings, so no float rounding crosses the wire.

**Size.** Most users have tens to a few hundred items (a few KB compressed). Accounts with very large histories exist
but are rare and are accepted as is: they are one cached response each, bounded by the ClickHouse row and byte limits.

### Cache headers (the only lever on Cloudflare)

Any new event changes the response, so there are no immutable pages: one policy, with the time-to-live chosen by how
likely the answer is to change soon.

| response | `Cache-Control` |
|---|---|
| user with an event in the last 2 hours | `public, max-age=5, s-maxage=15, stale-while-revalidate=60, stale-if-error=3600` |
| any other user | `public, max-age=30, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400` |
| user with no events | `public, s-maxage=60, stale-while-revalidate=300` (a normal `200` with an empty list) |
| invalid request, `429`, `5xx` | not cached (`no-store`), except the canonical redirect below |

A user who becomes active after being idle sees their first new event at most one long TTL late (about 60 s plus
revalidation), which is acceptable for a first action; once active they are on the 15 s policy. There is no
watermark. Prices are already on the rows (below); a price correction reaches a response within one stamping interval
plus one TTL.

Because we cannot purge Cloudflare, a correction to the data (a reorg fix, a reindex) reaches users within the TTL: at
most a day under `stale-if-error`, normally a minute.

ETags: the origin stores the ETag with each cached response (a hash computed when the response was built), so
`If-None-Match` is answered `304` from memory without querying.

## Cloudflare, as it is

Nothing to configure; three things to design for:

- **The edge cache key is the full URL including the query string**, and we cannot change that. So the origin must make
  non-canonical URLs cheap: any query parameter at all, or an upper-case address, gets a `308`
  redirect to the canonical URL, answered from memory in microseconds and never reaching ClickHouse. Cache busting
  (`?_=1`, `?_=2`, ...) then creates edge entries that all point at one canonical URL.
- **No edge rate limiting**, so enumeration and flooding must be absorbed by the origin (below).
- **The origin may be reachable directly**; assume it is. The client IP is trusted from `CF-Connecting-IP` only when the
  connecting hop is inside Cloudflare's published IP ranges (refreshed daily); a direct hit is limited by its socket IP.

## The origin (Hono)

In the order a request meets them:

1. **Validate and canonicalize** (zod): redirect or reject as above; reject the zero address, the burn address and every
   known Beefy contract (an in-memory set of the `Contract` table, refreshed hourly), because their timelines are huge and
   meaningless.
2. **Per-client rate limit** (token bucket per client IP, in memory; starting value 60 requests a minute with a burst of
   20, `429` with `Retry-After` beyond). A stricter global bucket applies to cache misses. This is the enumeration defence
   we cannot get from Cloudflare. With several instances each enforces its own bucket; that is acceptable (limit divided
   by instance count) and removes a shared store from the design.
3. **In-process cache** (LRU bounded by bytes, 128 MB) keyed by the canonical URL, with stale-while-revalidate and a TTL
   jittered by ±20 %. Expired entries are served while exactly one refresh runs.
4. **Single-flight**: concurrent misses on one key share one query (the existing CLM API already does this for two
   minutes).
5. **Concurrency limiter** for ClickHouse (8 in flight, queue of 64 waiting at most 250 ms); beyond it, `503` with
   `Retry-After`. **Circuit breaker**: after repeated ClickHouse failures, serve stale from memory and `503` otherwise.
6. **Response** with the `Cache-Control` of the table above, the stored ETag, `generated_at`, and security headers.
7. **Metrics**: cache hit rate per layer, ClickHouse queries per second and latency, sheds, rate-limited requests.

One instance with 512 MB to 1 GB is the starting point, two for availability. They are stateless.

## ClickHouse: account-first tables

In `envio_analytics`, written by migrations and views only; the API user is `readonly` with `SELECT` on this database.
Envio's tables are ordered by chain and token, which is wrong for "everything this account did", so the same facts are
re-keyed by account.

| table | sort key | rows | maintained by |
|---|---|---|---|
| `user_timeline` | `account, timestamp, chain_id, log_index` | one per balance change (share transfers, stakes, CLM deposits, withdrawals, reward claims), **unpriced**, with the amounts (`shares`, `shares_after`) and the price keys the row needs (share token, or the two CLM tokens, or the reward token); an `inserted_at` column | **insert-time views**, one per raw table (`BalanceChange`, `ClmDeposit`, `ClmWithdraw`, `RewardPaid`), that only project and re-key columns; rollback rows become tombstones (`ReplacingMergeTree(version)` with a plain `is_deleted` column: a deleted-flag engine would hide the tombstone from `FINAL`, and the stamping must see it to cancel the priced row; readers filter `is_deleted = 0`); partitioned by month so a catch-up can read one month |
| `token_supply` (later, only if CLM underlying balances are needed) | `chain_id, token, timestamp` | one per mint or burn: total supply after | projection view over `ShareTransfer` |
| `user_timeline_priced` | `account, timestamp, chain_id, log_index, kind, contract, event_id` | the same rows with prices, USD values and flags; **the only table the API reads**, grouped by transaction × product per request; **not partitioned, `index_granularity` 512** (a monthly partition split one account over a granule per month: measured 65 MB read for a 50 row account, now 1.3 MB) | the **stamping view** (below), into a `ReplacingMergeTree(version)` keyed by the event, version = stamp time |
| `stamp_queue`, `flagged_rows` | by insert time / timestamp, TTL 1 day / 7 days | the keys of rows written to `user_timeline` in the last day, and of priced rows that were not `OK` | views on `user_timeline` and on `user_timeline_priced`; they exist so the stamping finds its window without scanning tables ordered by account |

**Every row carries its share amounts.** `delta` (the signed share change) and `shares_after` (the balance of that one
contract after the change, from `BalanceChange.balanceAfter`) are stored on the row, so a value is always
`amount × price` with no lookup of the user's balance. A product's total balance across its vault, boosts and reward pools
is the running sum of `delta` over the account's rows of that product (a move between the vault and a boost nets to
zero); the integration test checks that this sum equals the indexer's recorded balance for every account and token.
CLM deposits and withdrawals also mint and burn shares, and those transfers already arrive as balance rows, so the CLM
rows only carry the underlying amounts (`amount0`, `amount1`) and a zero `delta`. (`token_supply` is only needed to derive a CLM's
underlying token amounts; see the pricing section.)

**The write path of the indexer stays trivial.** The views that feed `user_timeline` contain no join and no aggregation,
so they cost about one column projection per inserted row. A full reindex pays nothing for pricing. (A view that did the
as-of join at insert would be the opposite: ClickHouse rebuilds the right side for every inserted block.)

**The stamping view** is a refreshable materialized view in ClickHouse, not a job in our worker, so it survives
deploys, worker outages and restarts:

```
CREATE MATERIALIZED VIEW mv_stamp_recent
REFRESH EVERY 10 SECOND APPEND TO user_timeline_priced   -- no overlap: the next run starts after the previous ends
AS SELECT … FROM user_timeline <rows in stamp_queue from the last 3 hours> <two ASOF joins to the price table>
   <only rows that are new or whose price, flag or tombstone changed>
```

A second view, `mv_stamp_repair` (every 10 minutes), re-stamps rows listed in `flagged_rows` (priced with a flag other than
`OK` in the last 7 days). Both are in `packages/clickhouse/src/pricing.ts`.

- **Stateless and idempotent.** No checkpoint. Each run looks at the rows queued in the last 3 hours and writes only
  those that are new or whose price, flag or tombstone changed, so a run that finds nothing new writes nothing. Writing a
  row again with a newer version replaces it.
- **Catch-up is the same SQL over an explicit range**, run by a command (`stamp <from> <to>` in `packages/clickhouse`) in
  chunks. It is used after a long outage, after a reindex (the view is stopped with `SYSTEM STOP VIEW` for the duration of
  the backfill, then resumed) and when the price-per-full-share series finally lands.
- **Monitoring.** `priced_lag_seconds` (newest `user_timeline` insert minus newest `user_timeline_priced` insert) is
  exported on `/health` and as a metric; alert above 60 s. If the view fails or stops, the API keeps serving what is
  priced; only new events are late.

**Resource limits (the stamping must not take down the cluster).** Everything below applies to a dedicated ClickHouse user
for the view (`SQL SECURITY DEFINER`, so the refresh runs as that user):
- a **settings profile**: `max_threads` 2, `max_memory_usage` (a few GB, spills to disk beyond `max_bytes_before_external_*`),
  `max_execution_time` 8 s, `max_rows_to_read` and `max_bytes_to_read` sized for one window, `max_concurrent_queries_for_user` 1;
- a **quota** on queries, read rows and execution time per interval;
- **query-level `SETTINGS`** on the view's `SELECT`, so the limits travel with the view and do not depend on which user
  runs it;
- **workload scheduling** (CPU and IO caps) if the databarn version supports it.
A run that exceeds a limit fails and is retried at the next interval; the effect is `priced_lag_seconds` growing, never
cluster load. The window query has to be cheap by itself, not only capped: the main tables are ordered by `account`, so a time
window would scan them. The rows to stamp are therefore found through the two small queue tables (`stamp_queue`,
`flagged_rows`), and the big table is then read by key.
Whether the refresh really runs under the definer's profile and quota on the databarn version is **unverified** (below).

**Freshness.** An event is readable in `user_timeline` 1 to 2 s after the block when HyperSync is not throttled
(measured: 0.5 to 1.5 s), is priced up to 10 s later, and is served after the edge TTL (15 s). Worst case for a user:
block time (Base 2 s) + 2 s + 10 s + 15 s ≈ 30 s.

**Reorgs and reindex.**
- Only recent rows can change on a reorg. Tombstones flow into the stamping view's window, and caches expire within 15 s.
- A reindex (Envio drops its raw database) is a new deployment writing a new raw database. The migration job rebuilds
  `user_timeline` and `token_supply` from it, stamps them with the catch-up command, then swaps them in; since we cannot
  purge Cloudflare, the TTL bounds how long old responses can be served.
- The reorg behaviour of Envio's ClickHouse sink is **untested** (below).

## Pricing a transaction

**Where prices come from.** We never fetch a price from outside. The existing pipeline already lands cleaned prices into
the databarn ClickHouse. The stamping view reads that table, from the same cluster. No HTTP call, no price sync job,
nothing on the indexing path and nothing at request time.

**The price table** is `dbt.int_product_share_price`: one row per product per 15 minutes with the share price in USD already
computed (`share_to_usd`, `Decimal(76, 20)`), keyed `chain_id, product_address, date_time` (that is also its sort key, and it
is partitioned by month). Other columns: `beefy_key`, `price_source` (text, where the price came from: coingecko, on chain, correction, …; for
debugging) and `__rmt_version`. It is a
`ReplacingMergeTree`, so a price can be corrected by a newer version: the stamping reads it deduplicated (`FINAL` on the
narrow slice it reads, or `argMax` by version).

The sort key is what an as-of join wants: for a row `(chain_id, product_address, t)` only the granules of that product
around `t` are read. No derived price table is needed.

**What a row is priced from**

| item | inputs | source |
|---|---|---|
| classic vault position (vault, boosts, reward pools) | `shares_after` × `share_to_usd` | the table, joined on `(chain_id, vault address)`; a boost or reward pool stakes the vault share, so its rows are keyed by the vault (through `ContractLink`) |
| CLM position | `shares_after` × `share_to_usd` | the table, joined on `(chain_id, manager address)` |
| reward claims | amount × USD price of the reward token | the event, and `int_token_price` (not created yet; assumed `chain_id, token_address, date_time` → USD price, 15 minute, same shape and same as-of / interpolation rules) |

**No price-per-full-share series and no pool arithmetic are needed for USD values:** the table already holds the share price.

**CLM `underlying0` / `underlying1`.** Whether the timeline needs them is open. What is cheap: deposits and withdrawals
carry `amount0` and `amount1` in the event itself, so those are stored on the row at no cost. What is not free: a CLM's
underlying *balance* after an arbitrary transfer needs the pool amounts (`ClmPoolState` / `ClmTvl`, as-of the event) and
the total supply (`token_supply`, as-of), plus a USD price per underlying token from `int_token_price`. It is the same
stamping view with two more as-of joins and one small table; it touches neither the indexer nor the read path, and
adding it later only adds fields to the response. Plan: ship without the balances, keep the event amounts, add the
balances when the frontend confirms it needs them.

**Arithmetic.** `share_to_usd` is a 256-bit decimal and share amounts are wei integers: the stamping converts shares to a
decimal using the token's decimals before multiplying, and stores USD values as `Float64` (they are for display and
charting) so an overflow cannot fail a stamping run.

**`price_source`** is exposed on each price as is, so the frontend and we can see where a price came from. The stamping
does not interpret it.

**CLM managers** are expected to be in this table (`product_address` = the manager). If they are not, that is an issue for
the team that owns the table, not something to work around here.

**Interpolation, not just "last price".** The price at time `t` is the linear interpolation between the last price at or
before `t` and the first price at or after `t`:

```
price(t) = p0 + (p1 − p0) × (t − t0) / (t1 − t0)      (p0 = p1 when t = t0)
```

In ClickHouse that is two `ASOF` joins (backward with `>=`, forward with `<=`) and an expression. Consequences:

- **The first stamp is backward-only.** At insert the next price (up to 15 minutes later) does not exist yet, so the row is
  stamped with the last price at or before `t` and flagged `price_provisional`. Within one price interval the re-stamp
  replaces it with the interpolated value. A price therefore changes once, in the first ~20 minutes of a row's life, and
  is stable afterwards.
- **One side only** (a product's first events precede its price history, or a series has ended): the nearest price is used
  flat if it is within `MAX_PRICE_GAP` (starting 6 hours), flagged `price_extrapolated`; beyond that the value is 0 and
  the flag is `price_missing`.
- **A gap in the middle** (both neighbours exist but are far apart): interpolated when the gap is at most `MAX_PRICE_GAP`
  and flagged `price_stale` beyond that, with both `as_of` timestamps exposed.
- **Interpolation covers gaps in a series, not an absent series.** A product with no rows at all stays `price_missing`
  until the data exists; the catch-up command then re-stamps its history.
- Every price carries its timestamps (`prices[].as_of`, and `prices[].as_of_next` when interpolated).

**Re-stamp rules.** A row is re-stamped on each run while it is younger than `RESTAMP_WINDOW` (2 hours), or while it is
flagged `price_provisional`, `price_missing`, `price_extrapolated` or `price_stale` and younger than 7 days. Everything
else is frozen: no further work for settled rows. Flagged rows are few, so this stays cheap. A reorg, a late price and a
corrected price all flow through the same re-stamp.

**The timeline holds the value at each event, not today's value.** For "worth now" the frontend multiplies the latest
`share_balance` by a current price from the source it already uses for live prices (to confirm).

**Considered and rejected:** attaching prices in a materialized view at insert (hurts backfill), joining prices per request
(read cost grows with a user's history; a user with many products can exceed the read limits), a dictionary over the prices
(hundreds of millions of 15 minute entries in memory on a shared cluster) and calling a price service from the API (a
second dependency on the hot path).

## Aggressive patterns and what absorbs them

| pattern | absorbed by | what reaches ClickHouse |
|---|---|---|
| cache busting (`?_=random`) | `308` to the canonical URL, answered from memory | nothing |
| enumerating random addresses | per-IP and global miss rate limits at the origin; empty users cached 60 s; each miss is a few-granule read | a bounded trickle of tiny reads |
| rare accounts with huge history | one response per account, cached; ClickHouse row and byte limits | one read per TTL per account |
| the same popular address polled every second | edge `s-maxage`, origin cache, `304` | one refresh per TTL per key |
| popular key expires, everyone misses | stale-while-revalidate at both layers, single-flight, jittered TTL | one query per key |
| burn, zero or contract addresses | rejected before any lookup | nothing |
| direct hits on the origin | same rate limits keyed by socket IP | as above |
| slow clients, oversized requests | server timeouts, header and body limits | nothing |
| ClickHouse slow or down | limiter, breaker, stale from memory and the edge (`stale-if-error`) | reduced to breaker probes |

ClickHouse backstop for anything that slips through (settings profile of the API user): `readonly`, `max_execution_time`
3 s, `max_rows_to_read` 1 M, `max_bytes_to_read` 256 MB, `max_memory_usage` 1 GB, `max_concurrent_queries_for_user` 16,
a quota per interval, and the query cache on with a TTL of a few seconds.

## Verify before building

| unknown | how to settle it |
|---|---|
| Per-account read cost at production size | load synthetic Base-sized `user_timeline_priced` (hundreds of millions of rows), time the response query for a typical user and the largest account, read granules and rows from `system.query_log` |
| Cost of one stamping run, steady state and catch-up | on the same synthetic data plus a price table of the real resolution and sort key: run time, rows read and memory from `system.query_log`, with the limits of the stamping profile applied |
| Refreshable materialized views on the databarn ClickHouse | `SELECT version()`, Cloud or self-hosted, replicated or not; create a test `REFRESH EVERY … APPEND` view, check it does not overlap itself, and that it runs under the definer's profile and quota (read `system.query_log`, `system.view_refreshes`); check `SYSTEM STOP VIEW` |
| Envio's ClickHouse sink under a real reorg | follow a chain head across a reorg (or force one) and check the history tables and tombstones |
| Cloudflare really caches 200 JSON by `Cache-Control` and honours `stale-while-revalidate` | request a test URL repeatedly and read `CF-Cache-Status` and `Age` |
| Cloudflare collapses concurrent misses | fire concurrent requests for one new URL and count origin hits |
| `308` redirects are cached by Cloudflare | same, for a redirected URL |
| Price table coverage, keys and sort key | list the price table's keys, its sort key and resolution and, for every product in `Contract`, whether a share-price series (and, for CLMs, both token series) exists, and since when; check it is in the same cluster |
| The databarn v1 timeline contract | get a sample response so the field names and semantics can be aligned |
| Insert overhead of the projection views | measure the views' cost during a backfill and at the head (expected near zero) |
| `SQL SECURITY DEFINER` views on the databarn version | create views in `envio_analytics` over a raw database and select as a user without access to it |
| Latency with a production HyperSync token | rerun the head-lag measurement with the real token |

## Load test (the acceptance test)

Run against the origin behind a caching proxy that mimics Cloudflare (honours `Cache-Control`, full URL as key), then
against staging behind Cloudflare, with these scenarios together: cache-busting query strings; random-address
enumeration; 5 000 clients polling one popular address every second; a whale address (largest history in the data) fetched repeatedly; a burst of misses
after a deploy. Pass criteria:

- ClickHouse queries per second stay flat as client count grows (bounded by misses and the rate limits, not by clients);
- no query exceeds the settings profile; p99 origin latency under 100 ms on cache hits and under 300 ms on misses;
- one origin instance (1 vCPU, 512 MB) holds through the busting and enumeration scenarios without errors;
- with ClickHouse stopped, cached pages keep answering and the rest return `503` with `Retry-After`, then recover.

## Build order

1. `packages/clickhouse`: the three tables, the projection views, the stamping view with its user, profile and quota, the
   catch-up command, the migration runner, `priced_lag_seconds`, and a synthetic data generator for the load test.
2. Hono middleware: canonicalization, rate limits, cache with stale-while-revalidate, single-flight, limiter, breaker.
3. The timeline route (`GET /v1/users/{address}/timeline`, no parameters) and its response mapping .
4. The load test, tuned until it passes; the reorg and Cloudflare checks.

## Status and measurements

Built in `packages/clickhouse` (nothing deployed): the tables, the projection views, the stamping and repair views, the
catch-up command, a synthetic data generator, and tests. 16 integration tests run against a local ClickHouse 25.10 and
cover: one row per raw event (real Lisk data, 46 229 balance changes), the sums of the raw amounts, the running sum of
`delta` equals the indexer's balance for every account and token, rollback tombstones, backfill over rows the views
already saw, interpolation and every flag, price corrections, tombstones reaching the priced table, and idempotence.

Measured on synthetic data (3 000 000 events, 10.5 M prices, 300 products, local single node; not production numbers):

| what | result |
|---|---|
| catch-up stamping of the whole history | 3 M events in about 8 s (about 0.65 s per 30 day chunk) |
| one refresh of the stamping view over 1 000 new events | about 0.3 s, writes nothing when nothing changed |
| API read, typical account (50 rows) | 8 ms, 4 096 rows and 1.3 MB read |
| API read, whale (30 000 rows) / busiest account (50 000 rows) | 120 ms / 200 ms |
| API read before removing the monthly partitions | 15 ms but 204 800 rows and 65 MB for the same 50 row account |

Not measured: Base scale (hundreds of millions of rows), the real price table's cost, refreshable views under the
databarn cluster's profile and quota, and concurrent load.

### The timeline route, as built

`apps/api` serves `GET /v1/users/{address}/timeline`: the origin pipeline of this document is implemented (canonical
redirect, per-client token bucket with Cloudflare-aware client address, byte-bounded LRU with stale-while-revalidate and
stale-if-error, single-flight, a global budget for uncached requests, a concurrency limiter with a short queue, a circuit
breaker, ETag and `304`). The response is compressed once when it is built and the compressed copy is what a hit serves
(measured on the busiest Lisk account, 5 432 items: 3.8 MB raw, 295 KB gzip, about 1 ms from memory, 2 ms with the
`curl` round trip). Differences from the plan above:

- `actions`: `deposit` and `withdraw` are shares minted from or burned to the zero address (the indexer's `ShareTransfer`,
  projected as zero-delta `MINT` and `BURN` rows next to the balance rows) and CLM deposit and withdraw events;
  `stake` / `unstake` are boost moves; `transfer_in` / `transfer_out` are shares moving between accounts. The share
  movement that comes with a deposit, withdrawal, stake or unstake is folded into it. A deposit made through a zap or
  router mints to the router, which then transfers to the user, so it reaches the user as `transfer_in`; telling those
  apart needs the transaction's sender or the router list, not yet done.
- `product_key`, `display_name`, per-token underlying amounts in whole units, and the USD value of claims are not in the
  response yet (they need the Beefy API or token decimals and the `int_token_price` table). `underlying` and `claims`
  carry raw integer amounts in the meantime.
- Any failure to read ClickHouse is a `503` with `Retry-After: 5` and `no-store`; an old copy is served instead if one
  exists (`X-Cache: ERROR-STALE`, `Cache-Control` of 5 s).
- Beefy product contracts (vaults, managers, boosts, reward pools; read from `contract_product` hourly) and the zero and
  burn addresses answer `404`. Other contracts, such as routers and aggregators, are not recognised: they produce large
  responses like any other account.
