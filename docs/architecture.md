# Architecture

## Goal and principles

The indexer records raw on-chain facts about Beefy products (classic vaults, boosts, reward pools, CLMs, ERC-4626
adapters, LST vaults, configured share tokens) plus harvests, fees, rewards and swapper routes. A separate wrapper
service turns these facts into positions, values and PnL.

- **Raw facts only.** Amounts are raw integers (no decimals applied), addresses and hashes are lowercase `0x` hex. No
  prices, no share prices, no snapshots, no derived positions.
- **Calculations live in the wrapper.** Any formula can change without touching the indexer.
- **Reindex-averse.** Because nothing is derived, a reindex is only needed when a new raw fact must be captured.
  Every `eth_call` goes through a cached Envio effect, so a reindex replays reads from the effect cache.
- **Robust to Beefy API misconfiguration.** Decimals and token links come from the chain, so the wrapper can check
  the Beefy API against them.
- **No HyperSync dependency outside production.** The RPC variants and the tests run without HyperSync (see
  "Deployment modes").

## Entity model

Source of truth: `schema.graphql`. Every event row carries `chainId`, `blockNumber`, `blockTimestamp`, `trxHash`,
`trxFrom` (the EOA that sent the transaction, used to label zaps) and `logIndex`. Event row ids are
`chainId-trxHash-logIndex`.

### Registry and on-chain facts

- `Contract`: `kind` (VAULT, STRATEGY, BOOST, REWARD_POOL, CLM_MANAGER, CLM_STRATEGY, ERC4626_ADAPTER, LST_VAULT,
  SWAPPER, TOKEN, UNKNOWN), `factory`, creation block / timestamp / transaction, `deployName` (from `*WithName` and
  `ContractDeployed` events), `factsBlock` / `factsStatus` (OK or PARTIAL).
- `Token`: on-chain `decimals`, `symbol`, `name`, `metadataStatus` (INVALID when the reads revert) and
  `isBeefyShare`. Every share-token kind gets a share `Token` row, boosts included: a boost is not an ERC-20, so its
  row is INVALID and its decimals come from the BOOST_STAKED token.
- `ContractLink`: `fromAddress`, `toAddress`, `relation`, `source` (READ or EVENT), `sinceBlock`. READ links come
  from the one-time facts and start at the contract's creation block when known, else at the block of the event that
  read them. EVENT links are appended by `UpgradeStrat` (VAULT_STRATEGY) and `AddReward` (REWARD_POOL_REWARD), so
  history is kept. `vault.strategy()` is not read: the vault-to-strategy history is the STRATEGY_VAULT READ link of
  each strategy plus the VAULT_STRATEGY EVENT links.

### Balances

- `ShareTransfer`: every `Transfer` of a share token (classic vault, CLM manager, reward pool, ERC-4626 adapter, LST
  vault, configured `Token`). `totalSupplyAfter` is set on mints and burns only.
- `BalanceChange`: one row per balance side, with `delta`, `balanceAfter` and `source` (TRANSFER or BOOST_STAKE).
  This is the step function the wrapper multiplies by prices.
- `Balance`: current balance per `account x token` (running sum).
- `TokenSupply`: running total supply per share token. Mint = transfer from 0x0, burn = transfer to 0x0.
- `BoostStake`: boost `Staked` / `Withdrawn`. Each stake also writes a `BalanceChange` and updates `Balance` and
  `TokenSupply` keyed on the boost address, because the balances API treats boosts as share tokens.

Rules (`src/lib/balances.ts`):

- Every account except 0x0 gets `Balance` / `BalanceChange` rows: 0xdead, zaps and swappers included. Filtering
  holders is the wrapper's job. 0x0 is tracked by `TokenSupply` instead.
- A self-transfer or a zero-value transfer writes only its `ShareTransfer` row.

Classic vault `Deposit` / `Withdraw` events are not indexed: they are share mints and burns, already captured by
`ShareTransfer`.

### CLM

- `ClmDeposit` / `ClmWithdraw`: `user`, `shares`, `amount0`, `amount1` (deposits also `fee0`, `fee1`). This is the
  exact underlying cost basis, with no price lookup.
- `ClmTvl`: strategy `TVL(bal0, bal1)`.
- `ClmPoolState`: raw `price()`, `range()` and `balancesOfPool()` of the strategy at each block with a CLM `TVL` or
  `Harvest` event; `status` FAILED (failed fields unset) when a read reverts.

### Rewards

- `RewardNotified`: boost `RewardAdded` and reward-pool `NotifyReward` (`rewardToken` and `duration` for reward pools
  only).
- `RewardPaid`: boost and reward-pool claims. Boost reward tokens come from the BOOST_REWARD link.

### Strategy activity

- `Harvest`: classic `StratHarvest` (both ABI variants, see `src/config/classic/stratHarvest1`), CLM `Harvest`,
  `HarvestRewards`, `ClaimedFees`, `ClaimedRewards`, distinguished by `kind`.
- `FeesCharged`: `ChargedFees` v1 (beefy + liquidity fee) and v2 (call + beefy + strategist fee), classic and CLM.
- `PauseChange`: strategy `Paused` / `Unpaused`.

### Swapper

- `SwapperRoute` (current route per `fromToken -> toToken`) and `SwapperRouteChange` (history) from `SetSwapInfo`.
- `SwapperConfigChange`: `Initialized`, `SetOracle`, `SetSlippage`.

### Storage

`config.yaml` stores event tables in ClickHouse only (the storage default). Entities that handlers read, and the
current-state tables, opt into Postgres and ClickHouse with `@storage(postgres: true, clickhouse: true)`: `Contract`,
`Token`, `Balance`, `TokenSupply`, `SwapperRoute`. Handlers can only read Postgres. ClickHouse tables are ordered for
the wrapper's queries (`orderBy` on chain, token or contract, block, log index). `config.local.yaml` stores everything
in Postgres, with `schema.local.graphql` (the schema without `@storage` directives).

## Allowed eth_calls

Only reads whose count grows with the number of contracts, plus one per CLM TVL / Harvest block. All are Envio
effects with `cache: true`, chain-scoped, inputs keyed on lowercase addresses.

Facts, once per contract, read at `latest` (`src/effects/facts.effects.ts`, `src/effects/token.effects.ts`):

| kind | reads | links |
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

- These values are immutable once the contract is initialized; an early block is wrong anyway (`want()` / `wants()`
  return 0x0 until the strategy is initialized), so they are read at `latest`.
- They are read as soon as the contract is known: at its factory creation event, or at the first handled event of
  an address listed in config.yaml (`src/lib/registry.ts`). The preload pass issues them concurrently; the multicall
  batcher (`src/lib/viem.ts`) merges concurrent reads at the same block or at `latest` into shared aggregate3 calls.
- A complete answer is cached. An incomplete one (revert, or 0x0 where an address is expected) is not cached, sets
  `factsStatus = PARTIAL`, and is retried by a later event at most once per 10 000 blocks.
- Legacy vaults with broken `want()` use static facts (`src/config/classic/staticVaults.ts`), without an eth_call.

Classification, once per ClassicVaultFactory proxy whose kind is not otherwise known (see "Registry and
classification"): `vault()`, `strategy()`, `rewardToken()` in one multicall; exactly one must succeed. An UNKNOWN
answer is not cached.

CLM pool state, once per `(strategy, block)` with a `TVL` or `Harvest` event (`src/effects/clmPoolState.effects.ts`):
`price()`, `range()`, `balancesOfPool()` pinned to the event block. A harvest and the TVL event of the same block
share one read. This is the only read that scales with events.

## Registry and classification

- Factories emit the creation events; `contractRegister` handlers route the new address to its contract type (no
  effects there, so no RPC), and `onEvent` handlers write the `Contract` row and read its facts
  (`src/handlers/factories.handlers.ts`).
- ClassicVaultFactory deploys vaults, strategies and boosts with the same `ProxyCreated` event. The kind comes from,
  in order: the transaction input (`cloneVault` -> VAULT, `booooost` -> BOOST; `cloneContract` clones anything and
  calls through a multisig do not decode), the address's static listing in config.yaml, then the classification
  read. A proxy of unknown kind is registered under every candidate type (ClassicVault, ClassicStrategy, ClassicBoost).
- Kind precedence: the first established kind wins. An existing row is replaced only when its kind is UNKNOWN and
  the new one is not, so a `ContractDeployed` row or a failed classification never overwrites a kind set by a Beefy
  factory event or a classification read.
- Kind guard: every product handler calls `ensureContract`, which drops the event when the address already has
  another kind (a proxy registered under several types) or is blacklisted (`src/lib/blacklist.ts`; blacklisted
  addresses are not registered either).
- `ContractDeployed(bytes32,address)` is only accepted from ContractFactory addresses configured in config.yaml (none
  today): anyone can emit it and clone addresses are predictable. Its contracts are UNKNOWN.
- LST vaults, swappers and `Token` share tokens (mooBIFI, beTokens, BIFI) are listed in config.yaml only. Never list
  want tokens as `Token` (volume).

## Deployment modes and config generation

`config.yaml` is the hand-edited source, except its `# generated` address blocks (known contracts, below).
`pnpm config:generate` (`scripts/configVariants.ts`) writes the variants from it; `scripts/configVariants.test.ts`
fails when any generated file is stale.

| file | sync | storage | use |
|---|---|---|---|
| `config.yaml` | HyperSync with RPC fallback; hyperevm (999) and metis (1088) RPC only | Postgres + ClickHouse | production (`pnpm dev`, `pnpm start`) |
| `config.rpc.yaml` | RPC only (`for: sync` on every chain) | Postgres + ClickHouse | production without HyperSync (`pnpm start:rpc`) |
| `config.local.yaml` | RPC only | Postgres only (`schema.local.graphql`) | local and live test runs (`pnpm dev:local`) |

The RPC variants build no HyperSync source and need no `ENVIO_API_TOKEN`. Unit tests simulate events and replay
recorded RPC responses (`src/lib/rpcFixtures.ts`).

Known contracts. Static address lists only speed up a fresh index: Envio then starts each chain with a few address
partitions instead of one per factory registration block. Factory events still write the `Contract` rows of known
contracts (their re-registration is a no-op) and register anything missing from the lists. `pnpm known-contracts`
(`scripts/knownContracts.ts`) builds the lists:

- candidates from the Beefy API: `/vaults` (classic vaults and their strategy), `/cow-vaults` (CLM managers and their
  strategy), `/gov-vaults` (version 2 reward pools, older gov vaults), `/boosts`;
- every candidate verified on chain at `latest` (multicalls, two rounds per chain) with the handlers' classification
  (`src/lib/classify.ts`): a vault answers only `strategy()` and that strategy answers only `vault()`, pointing back
  to it (the API's strategy is also kept when it points back); a CLM manager's `wants()` returns two tokens and its
  `strategy()` has `vault()` = the manager; a reward pool answers `stakedToken()` and no classic detection call; a
  boost answers only `rewardToken()` among them and has a `stakedToken()`. The contract's shape decides between reward
  pool and boost (the API lists reward-pool contracts under `/boosts` too). Rejections are printed, blacklisted
  contracts are skipped, and a chain whose reads fail keeps its current list;
- the result replaces config.yaml's `# generated` blocks (sorted, minus hand-listed addresses), then the variants.

Changing static addresses changes the stored config, which requires a reindex (`-r`): regenerate the lists only when
planning one, and commit the result. They are never fetched at deploy time. ERC-4626 adapters (not in the API) and
contracts deployed after the last run are registered dynamically.

Multichain isolation. Envio 3.14 runs every chain in one process unless `ENVIO_PG_MAX_CONNECTIONS` is 4 or more (default
2); it then starts min(chains, connections / 2, 4) worker processes, dealing chains out in config order. In a single
process, a slow or erroring chain stalled the healthy ones: Fraxtal and Lisk (public RPCs, no HyperSync) stopped fetching
at about 72 000 processed events in total, for hours, while Monad crawled behind a flaky node (3 chains, 3 runs, also with
`ENVIO_IN_MEMORY_OBJECTS_TARGET` and `ENVIO_INDEXING_MAX_BUFFER_SIZE` at 100 million, so not a buffer cap). With
`ENVIO_PG_MAX_CONNECTIONS=8` the same three chains ran for 3 hours with no stall, Fraxtal and Lisk going well past the
old stall points while Monad stayed slow. Set it in every environment; list the busiest chains first in config order.

RPC partition size. With the known-contract lists, a chain's static addresses form one `eth_getLogs` address filter of
up to 5 000 addresses by default, which rpc.beefy.com answers slower than Envio's 20 s query timeout (BSC with 926 and
Arbitrum with 2 354 addresses timed out). The RPC scripts therefore set `MAX_PARTITION_SIZE=250`. Measured on Base, RPC
only, 3 minutes, same rate-limited endpoint: dynamic registration without static lists 175 events; static lists with
partitions of 5 000 / 50 / 250 addresses 7.4k / 17.8k / 21.1k events. The runs were noisy (140 to 280 HTTP 429 each)
but consistent in direction; re-measure with a production RPC token.

Verified end to end: Lisk (1135) indexed RPC-only from its first block to block 39 000 000 through the public
`rpc.api.lisk.com` and the pacer (`scripts/rpcPacer.ts`), then compared with the chain by `scripts/correctness.ts`: 14
checks passed, including 31 185 share transfers and 6 160 CLM deposits and withdrawals matched one to one, and every
`Balance` and `TokenSupply` row equal to `balanceOf` / `totalSupply` at the end block. Two factory clones that were
never initialized on chain stay PARTIAL by design.

RPC sync cost: one `eth_getBlockByNumber` per block with a handled event, one `eth_getTransactionByHash` per
transaction (for `transaction.from`, and `input` on ClassicVaultFactory events). Details in
`docs/envio-3.14-notes.md`, "RPC sync cost model".

## Wrapper responsibilities

- **Interactions**: group `ShareTransfer`, `BoostStake`, `ClmDeposit` / `ClmWithdraw` and `RewardPaid` by `trxHash`
  and label DEPOSIT, WITHDRAW, STAKE, UNSTAKE, ZAP_IN, ZAP_OUT (`trxFrom` is not the share receiver, or a zap contract
  is involved), TRANSFER_IN / TRANSFER_OUT, CLAIM.
- **Value over time**: `BalanceChange.balanceAfter` step function x share price x underlying USD price, joined at query
  time. No per-position snapshots.
- **Cost basis**: CLM from `ClmDeposit` amounts; classic from shares x the nearest share-price point x the underlying
  price.
- **Prices**: a sync job outside Envio copies the needed TimescaleDB series (share price per vault, USD price per
  token) into a separate ClickHouse database next to the indexer's: one backfill, then incremental pulls every 15
  minutes. Queries join with ClickHouse `ASOF JOIN` (nearest earlier point). The price database must not be the one named by
  `ENVIO_CLICKHOUSE_DATABASE`, which Envio truncates or drops on a reindex.
- **Gap rule**: TimescaleDB has 15-minute resolution and can miss points. Use the nearest point within 15 minutes,
  else the last known point within a maximum staleness (wrapper setting), else leave the value unpriced. Positions
  opened before the first known share price are priced at 0. Every priced figure says which rule produced it.
- **Misconfiguration guard**: compare Beefy API decimals and token links with `Token` and `ContractLink`; on mismatch
  trust the chain and flag the vault.

## Coverage of the existing APIs

Checked against `existing-apis/beefy-balances-api` and `existing-apis/beefy-clm-api` (local reference copies,
gitignored). Every endpoint can be served from these tables, with these differences:

- CLM price, range and main / alt split come from `ClmPoolState`.
- Harvest and timeline USD figures use 15-minute TimescaleDB prices instead of exact on-chain oracle prices.
- Indexes for the main query patterns: balance at a block (`BalanceChange (token, account, blockNumber, logIndex)`),
  top holders (`Balance (token, balance desc)`), investor timeline (`BalanceChange (account)`), harvests since a time
  (`Harvest (chainId, blockTimestamp)`).

Known gaps:

- The classic underlying breakdown (LP reserves, want total supply, breakdown token prices) is dropped: no event
  carries it.
