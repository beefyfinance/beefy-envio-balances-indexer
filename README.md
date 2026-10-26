# Beefy balances

A pnpm + Turborepo monorepo for tracking Beefy user positions and PnL: a raw-events indexer, a worker for background
jobs (starting with the price sync from TimescaleDB), and an API. Raw facts come from the chains, prices from the TimescaleDB on Tiger Cloud, and everything
derived (positions, values, PnL) is computed downstream, so changing a formula never forces a reindex.

```
apps/
  indexer/          @beefy/indexer          Envio HyperIndex 3.14 indexer (events → ClickHouse, state → Postgres)
  worker/           @beefy/worker           Background jobs: a small scheduler plus jobs, starting with the TimescaleDB price
                                            sync into ClickHouse (scaffold: scheduler and config done, the job is a stub)
  api/              @beefy/api              Read API over ClickHouse: Hono + zod-openapi (scaffold: /healthz, /v1/chains,
                                            /openapi.json)
packages/
  models/           @beefy/models           Dependency-free domain models: chain registry, hex helpers
  config/           @beefy/config           Typed fail-fast env parsing, ClickHouse connection settings
  tsconfig/         @beefy/tsconfig         Shared TypeScript settings (base, app, library)
docs/               Architecture and Envio reference notes
```

Start with [docs/architecture.md](docs/architecture.md) and the [indexer README](apps/indexer/README.md).

## Getting started

Requirements: Node 26.12.1 (`.nvmrc`; `nvm use` / `fnm use`) and pnpm 11.28.6 (pinned in `packageManager` and `engines`;
`corepack enable` picks it up).

```bash
pnpm install        # whole workspace, from the repo root
pnpm build          # packages compile to dist/ (apps import them from there)
pnpm test           # formatting check, typecheck and unit tests of everything
```

Each app has a `.env.example`; copy it to `.env` in that app's directory. Never commit a `.env`.

## Commands

All run from the repo root. 
| Command | What it does |
|---|---|
| `pnpm build` | Build the packages |
| `pnpm test` | Everything the CI gate checks: `format:check`, `test:ts` and `test:unit` |
| `pnpm test:ts` | `tsc --noEmit` in every package (builds the packages and runs the indexer's codegen first) |
| `pnpm test:unit` | Vitest in every package |
| `pnpm format` | Biome check with safe fixes, in every package and for the root files (`format:check` only reports) |
| `pnpm codegen` | Envio codegen for the indexer |
| `pnpm clean` | Remove build output and the Turborepo cache |
| `pnpm --filter @beefy/<app> <script>` | Any other script of one app (`dev`, `start`, `correctness`, ...) |

Every package defines the same `build`, `test`, `test:ts`, `test:unit`, `format` and `format:check` scripts, so inside
a package `pnpm test` and friends work on that package alone; the root ones fan out through Turborepo, in dependency
order and cached on their inputs (a second `pnpm test` with no changes is instant).

To work on one app, `cd` into it and use its own scripts (`pnpm dev`, `pnpm test`).

## Conventions

- **Versions are exact and locked.** Dependencies have no `^` or `~` (`savePrefix: ""`), and `pnpm-lock.yaml` is
  committed; install in CI with `pnpm install --frozen-lockfile`. Versions used by several packages live once in the
  `catalog:` of `pnpm-workspace.yaml` (`catalogMode: strict` rejects a different version in a package).
- **Supply chain.** New releases are not installable for a week (`minimumReleaseAge`), a package may not lose its
  trusted-publisher provenance (`trustPolicy: no-downgrade`), exotic (git / tarball) transitive dependencies are blocked,
  and install scripts only run for packages listed in `allowBuilds`.
- **Engines are enforced** (`engineStrict`): Node and pnpm versions come from `package.json` and `.nvmrc`.
- **Turborepo runs in strict env mode.** A task only sees the variables declared in `turbo.json`; add a new one to
  `passThroughEnv` (not hashed) or `env` (hashed, changes the cache key) on purpose. Telemetry: set
  `TURBO_TELEMETRY_DISABLED=1` (or run `pnpm exec turbo telemetry disable` once).
- **Internal packages are compiled.** `packages/*` build to `dist/` with `tsc` (ESM, `.ts` extensions in source are
  rewritten to `.js`) and export only `dist`, so an app can run on plain Node, also when deployed.
- **Fail fast configuration.** Apps read their environment through `@beefy/config`, which reports every problem at once,
  has safe defaults, and refuses a ClickHouse analytics database that equals the indexer's (Envio drops its own on a
  reindex).
- **The indexer is self-contained on purpose.** Envio Cloud deploys from a root directory and warns that imports from
  outside it can break the deployment, so `apps/indexer` depends on no workspace package and extends no shared
  tsconfig. `packages/models` has a test that keeps its chain list equal to the indexer's `config.yaml`.

## Adding an app or a package

1. Create `apps/<name>` or `packages/<name>` with a `package.json` named `@beefy/<name>` (`private: true`,
   `type: module`, `engines`), a `tsconfig.json` extending `@beefy/tsconfig/app.json` (or `library.json` for a package
   with an `outDir`/`rootDir`), and the standard scripts (`test`, `test:ts`, `test:unit`, `format`, `format:check`). Packages also need a `build` script and an `exports`
   map pointing at `dist`.
2. Use `catalog:` for versions that exist in the catalog, exact versions otherwise.
3. `pnpm install`, then `pnpm test`.

## Deployment notes

- **Indexer (Envio Cloud).** Point the indexer at the root directory `apps/indexer` (config file `config.yaml`).
  Not verified yet: a deploy from this layout, and which pnpm / Envio versions the cloud accepts.
- **Worker and API (Heroku).** Not set up yet. The API reads `PORT`; both shut down on `SIGTERM`. `WORKER_JOBS` picks
  which jobs a process runs, so each job can be its own process type. A monorepo build must run `pnpm build` for the
  packages before starting an app.
- **API caching.** Hono's `cache()` middleware needs the Web Cache API, which Node does not have, so the API sets
  `Cache-Control` and `ETag` (for browsers and any CDN in front) and leaves server-side caching to ClickHouse's query
  cache.
