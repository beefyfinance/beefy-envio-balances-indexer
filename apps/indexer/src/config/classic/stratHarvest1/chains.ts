import type { EvmChainId } from 'envio';

/**
 * Strategy addresses that emit `StratHarvest` with all fields indexed (Harvest1 ABI).
 * Ported from cowcentrated-subgraph `config/*.json` → `classicStratHarvest1ForAddresses`.
 *
 * Subgraph source files are noted per chain. All subgraph deployments use empty lists today.
 */
const CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN: Partial<Record<EvmChainId, readonly string[]>> = {
    1: [], // ethereum.json
    10: [], // optimism.json
    56: [], // bsc.json
    100: [], // gnosis.json
    137: [], // polygon.json
    143: [], // monad.json (subgraph config has no harvest1 field yet)
    146: [], // sonic.json / sonic-sentio.json
    252: [], // fraxtal — no subgraph deployment
    324: [], // zksync.json
    999: [], // hyperevm.json (subgraph config has no harvest1 field yet)
    1088: [], // metis — no subgraph deployment
    1135: [], // lisk.json
    1329: [], // sei.json
    4326: [], // megaeth.json (subgraph config has no harvest1 field yet)
    4663: [], // robinhood.json
    5000: [], // mantle.json
    8453: [], // base.json
    9745: [], // plasma.json (subgraph config has no harvest1 field yet)
    42161: [], // arbitrum.json / arbitrum-beta.json
    43114: [], // avax.json
    59144: [], // linea.json
    80094: [], // berachain.json
};

/** The Harvest1 strategy addresses of a chain (as listed, not normalised). */
export const classicStratHarvest1Addresses = (chainId: number): readonly string[] =>
    (CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN as Partial<Record<number, readonly string[]>>)[chainId] ?? [];
