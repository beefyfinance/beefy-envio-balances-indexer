# Timeline: migration plan

From where the code and environments are on 2026-10-29 to the target in [timeline-redesign.md](timeline-redesign.md).
Each phase ends with a check; a phase starts only when the previous one's check passed.

## Where we are

**Code** (working tree of `main`, not committed):

- `TimelineEvent` written by the indexer, with zap attribution; `BalanceChange` still written as well.
- `packages/clickhouse`: versions (`deploy`, `advance`, `switch`, `cleanup`, ...), `event_price_<N>`,
  `price_watermark_<N>`, the API views. `user_timeline_api` still prices the rows above the watermark at read time and
  joins the product facts live; `advance` stores only final rows (`OK` / `STALE` with complete facts).
- Prices from `analytics.asset_price_*` through `analytics.token`; the day filter fix for `asset_price_1d` is in.
- `apps/api` reads `user_timeline_api`; `apps/worker` runs `advance`, `cleanup`, `version-status`.
- Tests pass: indexer 150, config 9, clickhouse unit 10 and integration 33, worker 17, api unit 56 and integration 4.

**dev_mrt** (`clickhouse-databarn`):

| Object | State |
|---|---|
| `beefy_indexer_dev_mrt`: `deployments`, `event_price_5`, `price_watermark_5`, the three API views | version 5 active (Arbitrum slice from 2025-11-01, read-time pricing) |
| `envio_dev_mrt_5` | fed by Envio run 5, running from a local terminal with a local RPC pacer |
| the 22 stamping objects in `beefy_indexer_dev_mrt` (`user_timeline*`, `stamp_queue`, `mv_*`, `flagged_rows`, `contract_product`) | untouched, still attached to `envio_dev_mrt_4` |
| `envio_dev_mrt_4`, Postgres schemas `beefy_slice4`, `beefy_slice5` | run 4 (stopped) and both runs' Envio state |

**Pending manual steps from the first implementation:** `pnpm install` online (the lockfile was edited by hand),
`pnpm format`, `apps/worker/.env` (drop `CLICKHOUSE_ENVIO_DATABASE` and `CLICKHOUSE_PRICE_TABLE`; add
`CLICKHOUSE_ENVIO_DATABASE_PREFIX`, `CLICKHOUSE_PRICE_5M_TABLE`, `CLICKHOUSE_TOKEN_TABLE`,
`CLICKHOUSE_WATERMARK_PRICE_SOURCES`, `CLICKHOUSE_DEFINER`), and `access` re-run by an administrator.

No other environment runs either pipeline.

## Phase 0: land the first implementation

1. The manual steps above.
2. Commit the current state as is (version 5 on dev_mrt runs it).
3. Delete `apps/indexer/config.slice.yaml` from the working tree when run 5 is stopped (phase 4): it is the local
   slice config, not meant to be committed.

**Check:** `pnpm test` green after `pnpm install`; the worker starts with the new `.env`.

## Phase 1: indexer

One schema change, so one reindex for all of it.

1. **Price facts on `Contract`**: `productAddress` and `priceDecimals`, set in `src/lib/registry.ts` where the links and
   token metadata are read, with the rule of `productFactsCtes`. Unit tests on a vault, a CLM, a boost and a reward
   pool, including a vault whose want is read after its first events.
2. **Price cache module** (`src/lib/headPrices.ts`): the four Beefy API endpoints, refresh timers, previous map kept on
   failure, address mapping per chain, disabled in fixture mode. Unit tests with a stubbed `fetch`.
3. **`TimelineEvent` columns** `headPrice`, `headPriceAt`, `headProduct`, `headDecimals`, filled by the timeline
   writers under the age rules (event 10 min, price 15 min, facts known). Tests in `src/handlers/timeline.test.ts`.
4. **Stop writing `BalanceChange`**: move the indexer scripts and tests that read it to `TimelineEvent`, then remove the
   writer and the entity.

**Check:** indexer tests green; a short local run at the chain head writes `headPrice` on new events and leaves events
of the historical part empty.

## Phase 2: ClickHouse, API, worker

1. **Store every row** (`packages/clickhouse/src/deployments.ts`): `advance` and the late-row step insert all priced
   rows; `event_price_<N>` gets `facts_complete`. A table change, so it only applies to versions deployed after it.
2. **Retry window**: retry the rows of `[W - 7 days, W)` with no stored row or a non-final one, storing them again only
   when the result changed.
3. **Provisional rows**: after moving the watermark, `advance` prices the events above it with no `headPrice` and
   stores those whose result changed; the final step later replaces them (higher version).
4. **Switch gate**: `readiness <N>` counts the events older than 15 minutes with neither a stored row nor an indexer
   price; `ready` and `switch` refuse while it is not 0, unless `--force`.
5. **Read path** (`timeline.ts`): `user_timeline_api` reads events, the stored row (final or provisional), else the
   `head*` columns
   (`PROVISIONAL`, `price_source = 'indexer'`, `price_resolution = 'latest'`), else `PENDING`. No facts join, no
   `pricedEventsCtes`. `switch` refuses a version whose `TimelineEvent` has no `head*` columns (version 5): the new view
   cannot serve it, so going back to version 5 means going back to the phase 0 code.
6. **API**: `PENDING` in the `price_flag` enum, `latest` in `resolution`, `indexer` as a `price_source`; OpenAPI and
   tests.
7. **Worker**: `version-status` reports, for the active version, the share of the last hour's events without an
   indexer price (the signal for an indexer price cache that stopped) and the `PENDING` events older than 30 minutes.
8. **Integration tests**: stored row wins over the indexer price; `PENDING` when neither; `advance` stores `MISSING`
   rows and replaces them when prices arrive within the retry window; an event above the watermark with no indexer
   price gets a provisional row, replaced by the final one when the watermark passes it; `switch` refuses a version
   with `PENDING` events or without `head*` columns.

**Check:** every suite green; `seed-synthetic` plus a local load run shows the planning floor near 10 ms.

## Running Envio for phases 3 and 5

Both runs index from scratch on dev_mrt, from a local machine, next to the active version.

- **Config**: `config.yaml` restricted to the chosen chains (a local copy, not committed, like the slice config).
- **RPC**: the chain's public RPC behind `scripts/rpcPacer.ts`, one pacer per chain on its own local port (485xx, clear
  of other local projects). Chains are chosen on a probe of their public RPC (2026-10-29): a contract read at an old
  block (the handlers read state at the event's block) and a 1,000-block `eth_getLogs`.

  | RPC | Chains |
  |---|---|
  | archive and logs fine | optimism, sonic, linea, mantle, berachain, gnosis, plasma, megaeth, fraxtal, lisk |
  | usable with limits | avax and zksync (`eth_getLogs` capped), bsc (7.5 s per log query), ethereum (free plan, 10k-block ranges), base (rate-limited) |
  | not usable | arbitrum's public RPC, monad, sei, robinhood (no archive state); polygon (key disabled); hyperevm (log queries time out); metis (unreachable) |

- **HyperSync throttling**: HyperSync stays the sync source while it keeps up. Watch the log for `HyperSync source is
  rate-limited` (seen during run 5: the indexer waits 59 s each time). If a chain makes no progress for 10 minutes, or
  the waits add up to more than a quarter of the run time, restart without `-r` with `ENVIO_RPC_FOR=sync`
  (`pnpm start:rpc`): Envio resumes from its state and syncs from the RPCs only, through the pacers.
- Errors in the log (level 50 and above) stop the run for a look before going on.

## Phase 3: one young chain, end to end

**megaeth** (4326): the youngest chain in the config, 43 configured addresses, archive RPC fine. A short run that
exercises everything before spending hours on a large one. (Arc is not in the config; plasma, 64 addresses, is the
fallback.)

1. Run Envio with the phase 1 indexer into `envio_dev_mrt_6`.
2. `deploy 6 envio_dev_mrt_6`, `advance`. Right after the sync, every event of the last day has no indexer price: check
   that `advance` gave each a provisional row, that `readiness 6` reports no `PENDING`, and that `switch` refuses
   while it does.
3. `ready 6`, `switch 6`; the API serves megaeth accounts (`/v1/users/{address}/timeline`, `/health`, `/metrics`).
4. Leave it at the chain head for a day, then check:
   - new events carry an indexer price, and the share of events without one;
   - each indexer price against the final price that replaced it (same series a few minutes apart: a few percent at
     most), and the same for the provisional rows;
   - the flags and USD values of a sample of accounts against the analytics price tables by hand.
5. Answer open question 5 if megaeth has a vault whose want does not have 18 decimals (otherwise in phase 5).

**Check:** every step above works without manual fixes. Otherwise back to phase 1 or 2.

**Status (2026-10-29).** Run on **lisk** (1135) instead of megaeth: HyperSync throttled megaeth to zero progress even
with no other run on the token, and megaeth's public RPC settled at 1–4 requests/s (about 80 h to the head). Lisk,
RPC-only through the pacer: synced to the head in 65 min, no errors or warnings, 82,855 events, all with product facts.

- Gate: before `advance`, `readiness 6` reported 82,855 `PENDING` and `ready` refused; after `advance` (88 bounded
  statements, 37 s for two years), 0 `PENDING`; `ready 6`, `switch 6` done, version 5 retired (skipped by `advance` as
  unsupported, kept for the cleanup decision).
- Stored flags: 64,519 `OK`, 116 `STALE`, 178 `EXTRAPOLATED`, 18,042 `MISSING`. The missing ones are data: lisk vault
  share prices only start on 2025-12-09 in `analytics.asset_price_5m` (no `beefy_db` history), plus the July hole;
  one vault has no price asset.
- Read path on databarn (Arrow): 64 distinct accounts at 32 concurrent, 71 req/s, p50 0.31 s, p95 0.56 s (was 9 req/s,
  p50 3.4 s); planning 20–50 ms depending on server load.
- Integrity audit runs end to end (one bug fixed in a rewritten probe); sanity clean. Coverage reports 4 active lisk
  boosts not configured, a config gap independent of this work. `correctness` only runs its supply checks on a
  ClickHouse-storage run: its other checks read event tables from Postgres (local setup).
- Not covered by real data: lisk had no event in the last day, so provisional rows and indexer prices were only
  exercised by the integration tests. The day at the head (step 4) is running: Envio, pacer and the worker
  (`advance`, `version-status`; no `cleanup`).
- The API needs `output_format_arrow_compression_method = 'none'` for its user (admin change); until then it answers
  503 with an error naming the setting.

## Phase 4: clean dev_mrt

Each step only after asking the owner of dev_mrt, since it drops data:

1. `cleanup` drops version 5 after the grace period (its tables, then `envio_dev_mrt_5`).
2. Drop the 22 stamping objects in `beefy_indexer_dev_mrt` and `envio_dev_mrt_4`. They are not in `deployments`, so
   `cleanup` only reports them: by hand, materialized views first.
3. Drop the Postgres schemas `beefy_slice4` and `beefy_slice5`; stop the run 5 Envio process and its RPC pacer.

**Check:** `cleanup` reports no unknown database or table.

## Phase 5: seven chains, full history

**optimism, sonic, linea, mantle, berachain, gnosis, plasma**: all with a good archive RPC; optimism (1,201 configured
addresses) brings the large accounts, the others a spread of sizes and ages.

1. Run Envio into `envio_dev_mrt_7` from each chain's start block; record the sync time per chain, whether HyperSync
   was throttled (and whether the run switched to RPC only), and the RPC and Beefy API request counts.
2. `deploy 7`, time the first `advance` over the whole history (a scan of Envio's table by time), `readiness`,
   `ready`, `switch 7`.
3. Measure `user_timeline_api` with the scripts used for the 2026-10-29 numbers (64 distinct accounts, 1 / 8 / 32 at a
   time, plus the heaviest accounts):

   | Measure | Target |
   |---|---|
   | empty account, server time | under 30 ms |
   | heaviest account | under 300 ms |
   | 32 concurrent, distinct accounts | over 50 req/s, p95 under 1 s |

4. Check the Beefy API coverage per chain (products without an API price fall back to provisional rows), and repeat
   the phase 3 day-at-head checks.
5. Run it for a few days: watermark age, share of events without an indexer price, `PENDING` older than 30 minutes,
   errors; `cleanup` drops version 6 after the grace period.

**Check:** the targets met and the checks clean, or the design revisited with the numbers.

## Later

- Automate readiness (open question 4).
- USD values for claims (open question 7).
- Remove the superseded sections of `serving-architecture.md` once this design runs in production.
