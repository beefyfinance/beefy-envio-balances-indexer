# Beefy raw-events indexer

An [Envio HyperIndex](https://docs.envio.dev) 3.14 indexer that records raw on-chain facts about Beefy products on
22 EVM chains: share transfers and running balances, boost stakes, CLM deposits / withdrawals and pool state, rewards,
harvests, fees, pauses and swapper routes, plus a registry of Beefy contracts with their on-chain links and token
metadata. Amounts are raw integers; prices, positions and PnL are computed by a separate wrapper service.

- [docs/architecture.md](../../docs/architecture.md): principles, entity model, allowed eth_calls, deployment modes, wrapper
  responsibilities, API coverage and known gaps.
- [docs/envio-3.14-notes.md](../../docs/envio-3.14-notes.md): Envio 3.14.1 reference (config, handlers, effects, testing,
  running, RPC cost model).
- `schema.graphql`: the tables.

## Quick start

Requirements: Node 26, pnpm 11, Docker for `envio dev` (or external Postgres / ClickHouse, see the Envio notes).

This is one app of the monorepo (see the [root README](../../README.md)). Run the commands below from `apps/indexer`,
or from the repo root as `pnpm --filter @beefy/indexer <script>`.

```bash
pnpm install              # at the repo root
cd apps/indexer
cp .env.example .env      # ENVIO_API_TOKEN (HyperSync) and ENVIO_RPC_URL_<chainId> per chain
pnpm codegen              # .envio/types.d.ts from config.yaml + schema.graphql
pnpm dev                  # production config: HyperSync, Postgres + ClickHouse
```

Configuration comes from the environment, parsed and validated in one place each: `src/lib/config.ts` for the
indexer (RPC URLs and transport, multicall batching, Beefy API and head price ages, RPC fixtures; checked when the
handlers load, so a bad value stops the indexer at startup) and `scripts/lib/config.ts` for the scripts. Every variable
and its default is in `.env.example`. The scripts are commander CLIs: `pnpm <script> --help` lists their options.

The app is deliberately self-contained: it depends on no other workspace package and its `package.json` and
`tsconfig.json` do not extend anything outside this directory. Envio Cloud deploys an indexer from a root directory and
warns that imports from outside it can break the deployment, so shared code lives in `packages/` for the other apps,
not for this one (`src/lib/hex.ts` mirrors `@beefy/models`' hex helpers on purpose).

## Configs

One config (`config.yaml`) and one schema (`schema.graphql`), both hand-edited, except the `# generated` address
blocks inside config.yaml, which `pnpm known-contracts` writes. Storage is Postgres + ClickHouse (events in ClickHouse,
see the `@storage` directives); local infra comes from `pnpm infra:start` at the repo root.

The event source is chosen per run with an environment variable, not a second file:

| mode | how | sync |
|---|---|---|
| default | `pnpm dev`, `pnpm start` | HyperSync, RPC as fallback and for contract reads (hyperevm, metis: RPC only) |
| RPC only | `pnpm start:rpc`, or `ENVIO_RPC_FOR=sync` | every chain syncs over its RPC; no HyperSync and no `ENVIO_API_TOKEN` |

`ENVIO_RPC_FOR` fills the `for:` of each chain's rpc entry (`${ENVIO_RPC_FOR:-fallback}` in config.yaml). All scripts set
`ENVIO_PG_MAX_CONNECTIONS=8` (override with the env var), which makes Envio run one worker process per chain (see
"Multichain isolation" in [docs/architecture.md](../../docs/architecture.md)); production needs it too. `start:rpc` also
sets `MAX_PARTITION_SIZE=250`. The type check (`pnpm test:ts`) uses whichever codegen ran last (`pnpm codegen`).
Switching mode on one Postgres schema is fine; a changed config or schema needs `-r` (or a separate `ENVIO_PG_SCHEMA`).

## Known contracts

Known Beefy contracts are listed statically in config.yaml so a fresh index starts each chain with a few address
partitions. The lists come from the Beefy API and every entry is verified on chain at `latest` (details in
docs/architecture.md); the factory handlers still register anything missing.

Regenerating changes static addresses, which changes the stored config and **requires a reindex**: run it only when
planning one, then commit config.yaml and the variants.

```bash
pnpm known-contracts             # all chains (or chain ids as arguments); needs ENVIO_RPC_URL_<chainId> in .env
pnpm codegen
```

It takes about 20 seconds for the 22 chains and rewrites config.yaml's `# generated` blocks and the variants.

## Tests

```bash
pnpm test:ts                            # tsc --noEmit (uses the codegen that ran last)
pnpm test:unit                          # vitest run
pnpm test                               # both
RPC_FIXTURES=replay pnpm test:unit      # offline: fail on any missing RPC fixture (CI)
# at the repo root: `pnpm test` also checks formatting and runs every other package
```

Handler tests simulate events with `createTestIndexer`. Under vitest, every RPC state read goes through
`src/lib/rpcFixtures.ts`: answered from `test/fixtures/rpc/<chainId>/`, or fetched live once and recorded (needs the
chain's `ENVIO_RPC_URL_<chainId>`). Commit new fixtures. `RPC_FIXTURES=off` uses live RPC only.

## Correctness check

After an indexing run, compare what is stored in Postgres with the chain at a fixed block:

```bash
pnpm correctness --chain 1135 --schema raw_lisk --rpc http://localhost:8546 --config config.yaml
```

It checks every `TokenSupply` and `Balance` row against `totalSupply()` / `balanceOf()`, share-token, boost and CLM
events against the chain's own logs, a sample of event rows against receipts and blocks, `ClmPoolState` against
re-reads, and contract / token coverage. The block defaults to the indexer's last fully processed block
(`envio_chains.progress_block`); exit code 1 on any failure. Needs `psql` and an archive-capable RPC.

## Rate-limited RPCs

Envio's RPC source has no request-rate setting. For RPC-only runs against public or shared endpoints, put the pacer in
front of the RPC and point `ENVIO_RPC_URL_<chain>` at it (`http://127.0.0.1:<port>`; it listens on loopback only):

```bash
pnpm rpc-pacer --upstream https://rpc.api.lisk.com --port 8546 --rps 10 --max-rps 12 --concurrency 8
```

It paces with an adaptive rate (halved on rate limits, at most once per burst, raised after successes), retries
rate-limited and failed requests, and rebuilds `eth_getTransactionByHash` answers from the full block when a node
returns `null` for an old transaction. Production uses rpc.beefy.com (eRPC), which does this upstream.

## Integrity audit

After a sync, check the ClickHouse tables against the Beefy API catalog and the internal invariants:

```bash
pnpm integrity --chains 8453,42161 [--sample 20]
```

It reads `ENVIO_CLICKHOUSE_*` (defaults: local ClickHouse) and `BEEFY_API_URL` (default https://api.beefy.finance),
and exits 1 on errors (missing active products, missing links or share tokens, ledger drift).

## Other scripts

- `pnpm format` (repo root): oxfmt over the whole repo (the only format command).
- `pnpm db:console`, `pnpm db:console:clickhouse`: database shells for the local Docker setup.
- `pnpm stop`: delete the local Docker environment (including the effect cache, unless dumped).
- `pnpm run deploy` (repo root): fast-forward the `prod` branch to `origin/main` and push it.
