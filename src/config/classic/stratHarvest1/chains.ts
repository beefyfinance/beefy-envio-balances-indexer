import type { EvmChainId } from 'envio';
import type { Bytes } from '../../../lib/hex';

/**
 * Strategy addresses that emit `StratHarvest` with all fields indexed (Harvest1 ABI).
 * Ported from cowcentrated-subgraph `config/*.json` → `classicStratHarvest1ForAddresses`.
 *
 * Subgraph source files are noted per chain. All subgraph deployments use empty lists today.
 */
export const CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN: Partial<Record<EvmChainId, readonly Bytes[]>> = {
    1: [], // ethereum.json
    10: [], // optimism.json
    25: [], // cronos — no subgraph deployment
    30: [], // rootstock.json
    56: [], // bsc.json
    100: [], // gnosis.json
    137: [], // polygon.json
    143: [], // monad.json (subgraph config has no harvest1 field yet)
    146: [], // sonic.json / sonic-sentio.json
    250: [], // fantom — no subgraph deployment
    252: [], // fraxtal — no subgraph deployment
    324: [], // zksync.json
    999: [], // hyperevm.json (subgraph config has no harvest1 field yet)
    1088: [], // metis — no subgraph deployment
    1101: [], // zkevm — no subgraph deployment
    1135: [], // lisk.json
    1284: [], // moonbeam.json
    1285: [], // moonriver — no subgraph deployment
    1329: [], // sei.json
    2222: [], // kava — no subgraph deployment
    4326: [], // megaeth.json (subgraph config has no harvest1 field yet)
    5000: [], // mantle.json
    8453: [], // base.json
    9745: [], // plasma.json (subgraph config has no harvest1 field yet)
    42161: [], // arbitrum.json / arbitrum-beta.json
    43114: [], // avax.json
    534352: [], // scroll.json
    59144: [], // linea.json
    80094: [], // berachain.json
};
