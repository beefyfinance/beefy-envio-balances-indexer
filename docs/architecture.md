# Architecture

Paths starting with `src/` are relative to `apps/indexer/`. Envio's behaviour is in [envio-3.14-notes.md](envio-3.14-notes.md).

## Overview

```
 chains, Beefy API ──▶ indexer ──▶ Envio database: events, facts, indexer prices
                                     │                    │
 analytics prices ──▶ worker (advance) ◀──────────────────┤
                                     ▼                    ▼
                           event_price_<N> ──▶ user_timeline_api(account) ──▶ API ──▶ Cloudflare ──▶ client
```

- **Raw facts.** The indexer stores raw integers and lowercase hex read from the chain, so the Beefy API can be checked
  against them. Its only non-raw value is the indexer price, which is always replaced later.
- **Few reindexes, no copies.** Formulas live downstream, every `eth_call` is a cached Envio effect, and ClickHouse reads
  Envio's tables in place.
- **No pricing at read time.** The worker stores prices and a read is a lookup. A watermark, about a day behind now,
  splits final prices from temporary ones.
- **The API only runs a query.** A reindex is a new version next to the active one, and the API switches atomically. Results
  are `ArrowStream`, decoded by the API: API servers are easy to add, ClickHouse servers are not. The frontend computes PnL.

## Indexer

One hand-edited `config.yaml` with 23 chains. `pnpm dev` and `pnpm start` use HyperSync with RPC fallback (hyperevm and
metis are RPC only). `pnpm start:rpc` sets `ENVIO_RPC_FOR=sync`: every chain syncs over RPC, with no `ENVIO_API_TOKEN`.

Tables are in `schema.graphql`, ClickHouse only by default. Event rows carry block and transaction fields, with `trxFrom` (the
EOA) to label zaps. Handlers read only Postgres, so `Contract`, `Token`, `Balance`, `TokenSupply` and `SwapperRoute` are in
both, and `ShareFlow` is Postgres only.

### Registry and on-chain facts

- `Contract`: `kind`, `factory`, creation block, `deployName`, `factsBlock`, `factsStatus` (OK or PARTIAL), and the
  [price facts](#price-facts-on-contract).
- `Token`: on-chain `decimals`, `symbol`, `name`, `metadataStatus`, `isBeefyShare`. Every share-token kind gets a row. A
  boost is not an ERC-20: its row is INVALID and its decimals come from the BOOST_STAKED token.
- `ContractLink`: `relation`, `source`, `sinceBlock`. READ links come from the one-time facts. EVENT links are appended
  by `UpgradeStrat` and `AddReward`, so history is kept. `vault.strategy()` is never read.
- `contractRegister` handlers route a new address to its contract type, with no RPC. `onEvent` handlers write the row.
- ClassicVaultFactory deploys vaults, strategies and boosts with one `ProxyCreated`. The kind comes from the transaction
  input, then the static listing in config.yaml, then a classification read. A proxy of unknown kind is registered under
  every candidate type.
- The first established kind wins: only an UNKNOWN row is replaced. `ensureContract`, called by every product handler,
  drops the event when the address has another kind or is blacklisted.
- `ContractDeployed` is accepted only from ContractFactory addresses in config.yaml (none today): anyone can emit it.
- LST vaults, swappers and `Token` share tokens are listed in config.yaml only. Never list want tokens: too much volume.

### Balances

- `ShareTransfer`: every `Transfer` of a share token. `totalSupplyAfter` is set on mints and burns only.
- `TimelineEvent` (`kind = BALANCE`): one row per balance side ([other kinds](#timelineevent)).
- `Balance` (account and token) and `TokenSupply`: running sums. A mint is a transfer from 0x0, a burn a transfer to 0x0.
- `BoostStake`: boost `Staked` / `Withdrawn`. Boosts count as share tokens: each also updates `Balance` and `TokenSupply`.

Every account except 0x0 gets `Balance` and `BALANCE` rows, 0xdead and zaps included. A self-transfer or zero-value
transfer writes only its `ShareTransfer`. Classic vault `Deposit` / `Withdraw` are not indexed: they are mints and burns.

### CLM

`ClmDeposit`, `ClmWithdraw` (`user`, `shares`, `amount0`, `amount1`, fees on deposits: the cost basis), `ClmTvl`, and
`ClmPoolState`: raw `price()`, `range()`, `balancesOfPool()` at each block with a `TVL` or `Harvest`.

### Rewards

`RewardNotified` (boost `RewardAdded`, reward pool `NotifyReward`) and `RewardPaid` (claims; boost reward tokens come from
the BOOST_REWARD link).

### Strategy activity

`Harvest` (classic `StratHarvest` in both ABIs, CLM `Harvest`, `HarvestRewards`, `ClaimedFees`, `ClaimedRewards`, told apart
by `kind`), `FeesCharged` (`ChargedFees` v1 and v2) and `PauseChange`.

### Swapper

`SwapperRoute` (current), `SwapperRouteChange` (history, from `SetSwapInfo`) and `SwapperConfigChange`.

### Allowed eth_calls

Only reads that grow with the number of contracts, plus one per CLM TVL or Harvest block. All are cached, per-chain
effects. Facts run once per contract, at `latest`, because they are immutable once initialized:

| Kind | Reads | Links |
|---|---|---|
| any token | `decimals()`, `name()`, `symbol()` | `Token` row |
| VAULT | `want()`, else `token()` | VAULT_WANT |
| STRATEGY | `vault()` | STRATEGY_VAULT |
| CLM_STRATEGY | `vault()`, `pool()` | CLM_STRATEGY_MANAGER, CLM_POOL |
| BOOST | `stakedToken()`, `rewardToken()` | BOOST_STAKED, BOOST_REWARD |
| REWARD_POOL | `stakedToken()` | REWARD_POOL_STAKED |
| CLM_MANAGER | `wants()` | CLM_WANT0, CLM_WANT1 |
| ERC4626_ADAPTER | `vault()` | ADAPTER_VAULT |
| LST_VAULT | `asset()`, else `want()` | VAULT_WANT |

- A complete answer is cached. An incomplete one, failed token metadata included (a public RPC under load fails like a
  revert), sets `factsStatus = PARTIAL` and is retried at most once per 10 000 blocks.
- Classification: `vault()`, `strategy()`, `rewardToken()`, once per proxy of unknown kind. Exactly one must succeed.
- CLM pool state: once per `(strategy, block)`, pinned to the block. This is the only read that scales with events.

### Known contracts

Static address lists only speed up a fresh index: Envio starts each chain with a few partitions. Factory events still write
the rows and register anything missing. `pnpm known-contracts` verifies Beefy API candidates on chain and rewrites the
`# generated` blocks. Changing static addresses requires a reindex, so regenerate only when planning one.

### Multichain isolation

A slow chain must not stall the others, so set `ENVIO_PG_MAX_CONNECTIONS` to 4 or more everywhere and list the busiest chains
first ([how Envio splits them](envio-3.14-notes.md#multi-process)). `src/perChain.test.ts` keeps the indexer per-chain:
`disable_default_cross_chain: true`, no `@crossChain`, `crossChain: false` on every effect.

## Timeline and prices

The timeline is every action of an account on Beefy products, with its USD value. Envio's database `envio_<env>_N` holds
`envio_history_TimelineEvent`, sorted by account, the product facts and `envio_chains`. Our database
(`CLICKHOUSE_ANALYTICS_DATABASE`) holds `event_price_<N>`, `price_watermark_<N>` (with Envio's frontier per chain at each
move), `deployments`, and the only objects the API reads: `user_timeline_api(account)`, `product_contracts_api`, `api_status`.

### TimelineEvent

| Kind | Written by | Account |
|---|---|---|
| `BALANCE` | share token `Transfer`, boost stake and withdraw | each side of the balance change |
| `MINT`, `BURN` | share token `Transfer` from or to 0x0 | the receiver, the sender |
| `CLM_DEPOSIT`, `CLM_WITHDRAW` | CLM manager `Deposit`, `Withdraw` | the user |
| `CLAIM` | reward pool and boost `RewardPaid` | the user |

- **Zap attribution** (`src/lib/timeline.ts`). An account that receives freshly minted shares and forwards the same value
  gives the receiver a `MINT` at the forwarding log. An account that receives a value and burns it gives each sender a
  `BURN` at its transfer log. The router keeps its row, no row is updated, and earlier legs live in `ShareFlow`.
- **Invariants.** Ids are `chainId-trxHash-logIndex-account-kind`. A handler never deletes a `TimelineEvent` and an id never
  changes account: a `DELETE` history row has empty data columns, so a read filtered on account would keep the old row.
- **Rollbacks** need nothing: Envio deletes rolled-back rows, and reads stop at the committed checkpoint per chain.

### Indexer prices

`src/lib/headPrices.ts` keeps the latest share price per product in memory: `/mootokenprices` with `/vaults` for classic
vaults, `/lps` with `/cow-vaults` for CLMs, and boosts and reward pools take the price of `Contract.productAddress`. Prices
refresh every minute and mappings every 10 minutes; a failed fetch keeps the previous data, and handlers never wait. It is
not an Envio effect, because effects cache by input and this value depends on when it is read.

An event gets a price only if, when its handler runs, it is at most 10 minutes old, the price is at most 15 minutes old (a
stuck refresh stops pricing instead of spreading an old price), and the contract's price facts are known. The value is not
deterministic, which is fine because the watermark always replaces it. `headPrice` and `headPriceAt` are unset when not
priced; `headProduct`, `headDecimals`, `headProductKind` and `headContractKind` are set whenever the facts are known. Events
with no indexer price get a provisional stored row from the next `advance`, so they show `PENDING` for at most one period.

### Price facts on Contract

Handlers cannot read `ContractLink` (ClickHouse only), so `Contract` carries these, set in `src/lib/registry.ts`:
`productAddress` (the contract itself for a vault or CLM manager, the staked product for a boost or reward pool),
`priceDecimals` (want decimals for a classic vault, share decimals otherwise) and `productKind`. The rule is the one of
`productFactsCtes` (`packages/clickhouse/src/events.ts`), the source of truth for stored rows.

### Read path

1. **Events**: filter by account first (the sort key), keep rows at or below the committed checkpoint of their chain, take
   the latest row per id, keep it if it is a `SET`.
2. **Price**: the stored row matching `event_id` and timestamp; else the indexer price (`PROVISIONAL`); else `PENDING`. USD
   values exist for `BALANCE` rows only.

### Stored prices

`event_price_<N>` holds every event below the watermark, whatever its flag (a row left out would stay unpriced forever), and
the events above it that the indexer did not price. `advance` runs for each live version, at one frontier:

1. **Late rows**: events committed since the recorded frontier with a timestamp below the watermark.
2. **Retry window**: events of the last `REPRICE_RETRY_DAYS` below the watermark with no final row (none, a flag other than
   `OK` or `STALE`, or incomplete facts). This catches late prices and links, and rows replayed after a rollback.
3. **Watermark**: events between the old and new watermark. The first advance starts at the day of the oldest event.
4. **Provisional rows**: events at or above the new watermark without `headPrice`, stored only if the result changed.

- **Watermark rule**: `min(now - WATERMARK_MIN_AGE_HOURS, freshest price of each required source - 6 h)`, sources from
  `CLICKHOUSE_WATERMARK_PRICE_SOURCES`. If a source stops, the watermark stops: nothing is final with a stale price.
- **Bounded statements.** Each covers at most `ADVANCE_STEP_DAYS` and about `REPRICE_MAX_EVENTS` events, with per-query limits,
  so its cost never depends on the length of history.
- **Repricing history.** `rewind` moves the watermark back. The next advances reprice the rows above it without an indexer
  price as provisional rows, then store them as final as the watermark catches up. A `rewind` during an advance stops it (`superseded`), through a compare-and-set on `moved_at`. `reprice`
  rewrites a range without moving the watermark. `FINAL` hides the old rows until a merge.

### Prices

The SQL is `pricedEventsCtes` (`packages/clickhouse/src/pricing.ts`). `analytics.token` maps the product's share token to one
`asset_id`, never its want's. Prices from `analytics.asset_price_5m` are interpolated linearly between the nearest price each
side, each within 48 h, so an event's price never depends on the other events in the statement. `share_to_usd` is per
10^(want decimals) share units for a classic vault, 10^(share decimals) for a CLM. Every pick is deterministic.

| Flag | Stored | Meaning |
|---|---|---|
| `OK` | yes | interpolated between prices at most 6 h apart |
| `STALE` | yes | interpolated between prices further apart |
| `EXTRAPOLATED` | yes | a price on one side only, carried flat |
| `MISSING` | yes | no price within reach, USD 0 |
| `PROVISIONAL` | read only | the indexer's price (`price_source = 'indexer'`, `price_resolution = 'latest'`) |
| `PENDING` | read only | no stored row and no indexer price, USD 0 |

## Versions and operations

`building → ready → active → retired → dropped`, recorded in `deployments`.

- **building**: Envio indexes into `<CLICKHOUSE_ENVIO_DATABASE_PREFIX><N>`, the only name `deploy` accepts, and the worker
  fills the version's tables. RPC and Beefy API calls double during a reindex.
- **ready**: set by hand once `readiness <N>` looks right. **active**: the API views point at it.
- **retired**: kept for a grace period, so a switch can be undone with `switch <old> --force`.
- **dropped**: its tables, then its Envio database, are gone. Envio's Postgres schema stays.
- **Gates.** `ready` and `switch` refuse a version with no indexer price columns or with `PENDING` events older than
  `PENDING_GRACE_MINUTES`. `switch` also refuses a version that is not `ready`. `--force` overrides these.
- **Switch.** States are recorded first, so a switch that dies halfway leaves nothing cleanup could drop under the API, and
  rerunning converges. Each view is built as `<name>_next` and swapped with `EXCHANGE TABLES`: `CREATE OR REPLACE` with a
  definer leaves dependency records behind.
- **Cleanup.** Every step is recorded and safe to rerun. A version one of our views still names is skipped. Only `<prefix><N>`
  of the version's own N is dropped, never a system, ours or price database. Unknown objects are reported, never dropped.
- **Access.** `beefy_api` reads the three views only, under a readonly [profile](#limits). `beefy_pipeline` (worker, CLI)
  creates and drops in our database, reads and drops `<prefix>*`, and reads the price tables. The views run as
  `CLICKHOUSE_DEFINER`, so the API needs no other grant. The indexer's user is not managed here.

| CLI command (`packages/clickhouse/src/cli.ts`) | Does |
|---|---|
| `migrate` | create our database and `deployments` (the first `switch` creates the views) |
| `access [envioPrefix]` | create users, profiles and quota (administrator; `PIPELINE_PASSWORD`, `API_PASSWORD`) |
| `deploy <N> <envioDatabase>`, `list` | create version N's tables and register it; list versions |
| `readiness <N>`, `ready <N> [--force]` | report, then mark N ready |
| `switch <N> [--force]` | point the API at N, retire the previous version |
| `advance`, `cleanup [--grace-hours H]` | run a worker job once |
| `rewind <N> <time>`, `reprice <N> <from> <to>` | see [Stored prices](#stored-prices) |

Worker jobs (`WORKER_JOBS`): `advance` every 15 min, `cleanup` daily with 48 h grace, `version-status` every 5 min. They warn on
a watermark older than 2 days, a version `building` for 7 days, no active version, over 50% of the last hour's events without an
indexer price, `PENDING` events older than 30 minutes, and refused drops. Variables and defaults are in each `.env.example`.

SQL is built only with the `sql` tag (`packages/clickhouse/src/sql.ts`): values through `param`, names through `ident`. A plain
string fails to compile, and the `beefy/no-untagged-sql` oxlint rule catches what types cannot see.

## Public API and caching

`GET /v1/users/{address}/timeline` (`apps/api`, Hono) is public, so the worst case is a scraper enumerating addresses. Cloudflare
honours `Cache-Control` and nothing else: no rules, custom keys or purges. Every other defence lives in the origin, and overload
degrades to stale data or a clean `429` or `503`.

No parameters and no pagination: the whole history in one response, one cache entry per user. Items are newest first, one per
transaction and product, with `actions[]`, share balances, a `price` object ([flags](#prices)) and USD values (`/openapi.json`).

### Cache headers

An active user has an event in the last 2 hours. Origin lifetimes are jittered ±20 %, plus 1 h kept for errors.

| Response | `Cache-Control` | Origin fresh / stale |
|---|---|---|
| active user | `public, max-age=5, s-maxage=5, stale-while-revalidate=5, stale-if-error=3600` | 4 s / none |
| any other user | `public, max-age=30, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400` | 45 s / 60 s |
| user with no events (`200`, empty) | `public, s-maxage=60, stale-while-revalidate=300` | 45 s / 60 s |
| old copy after a failed refresh | `public, max-age=5, s-maxage=5, stale-if-error=3600` | |
| `308` to the canonical URL | `public, max-age=3600, s-maxage=86400` | |
| `400` not an address | `public, max-age=86400, s-maxage=86400` | |
| `404` zero, burn or Beefy product contract | `public, max-age=3600, s-maxage=3600` | |
| `413` too many rows | `public, s-maxage=300` | 5 min |
| `429`, `503`, `504` | `no-store` | |

A data fix reaches users within the lifetime, normally a minute. The ETag hashes the items only, and a hit answers `304` from
memory. The cache key holds the active version, read every 10 s, so a switch never serves old timelines.

### The origin

Cloudflare keys on the full URL, so any query string or upper-case address gets a `308` from memory: cache busting ends there.
Then, in order: per-client rate limit, in-process LRU (a stale entry is served while one refresh runs), per-client then global
miss budgets, single-flight, circuit breaker, concurrency limiter, and the build, which keeps a running share sum per product and
gzips once. On failure an old copy beats an error; otherwise a `503` with `Retry-After: 5`.

`CF-Connecting-IP` is believed only when the hop that reached us is inside Cloudflare's ranges (`CLIENT_IP`, list updated by hand
in `apps/api/src/http/clientIp.ts`). Each instance enforces its own buckets. `/health` and `/metrics` need `OPS_TOKEN`.

### Limits

Defaults, all in `apps/api/.env.example`: 60 requests a minute per client (burst 20); 20 misses a minute per client (burst 10);
1500 misses a minute overall (burst 100); 4 ClickHouse queries in flight, a queue of 64, 250 ms wait; 3.5 s query and 10 s request
timeouts; 10 000 rows per account, then `413`; a 128 MB cache. The breaker opens for 10 s after 5 failures, then lets one probe.
The backstop is the API user's readonly profile (`packages/clickhouse/src/access.ts`): 3 s, 2 M rows, 256 MiB read, 1 GB memory, 4
threads, 16 concurrent queries, and a quota of 3000 queries and 3 G rows a minute.

## Freshness

Real zap deposits into a reward pool on MegaETH with an indexer price, active cache of 5 s, indexer at the head, one sample
per refresh rate, behind a simulated browser cache and CDN (`pnpm watch-timeline`). Real Cloudflare and production RPCs are
not measured.

| Step | Seconds after the block |
|---|---|
| indexed and readable in ClickHouse | 3 |
| seen by a user refreshing every 15 s | 14.7 |
| seen by a user refreshing every 30 s | 23.8 |

## Open questions

1. A real rollback: can a reader filtering on `envio_chains` see a row Envio is about to delete? Only simulated so far.
2. `ready` stays manual: nothing compares event counts between versions or checks that Envio reached the chain head.
3. Indexer price unit: confirm on a vault whose want does not have 18 decimals that the API price matches analytics.
4. Products the Beefy API does not list rely on provisional rows, which lag with the analytics tables. Is that fine?
5. Claims have no USD value (`claims[].usd` is null). They need reward token prices.
6. Cloudflare: that it caches `200` JSON and `308`s, honours `stale-while-revalidate` and collapses concurrent misses.
7. The response has not been compared with a databarn v1 timeline sample.
