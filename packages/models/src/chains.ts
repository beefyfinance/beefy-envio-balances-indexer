/**
 * The chains Beefy runs on and this workspace indexes. `key` is the Beefy chain key (the name used by
 * api.beefy.finance and the TimescaleDB price tables); `id` is the EVM chain id. The indexer app checks this list
 * against its own `config.yaml`, so adding a chain means touching both.
 */
export const CHAINS = [
    { id: 1, key: 'ethereum' },
    { id: 10, key: 'optimism' },
    { id: 56, key: 'bsc' },
    { id: 100, key: 'gnosis' },
    { id: 137, key: 'polygon' },
    { id: 143, key: 'monad' },
    { id: 146, key: 'sonic' },
    { id: 252, key: 'fraxtal' },
    { id: 324, key: 'zksync' },
    { id: 999, key: 'hyperevm' },
    { id: 1088, key: 'metis' },
    { id: 1135, key: 'lisk' },
    { id: 1329, key: 'sei' },
    { id: 4326, key: 'megaeth' },
    { id: 4663, key: 'robinhood' },
    { id: 5000, key: 'mantle' },
    { id: 5042, key: 'arc' },
    { id: 8453, key: 'base' },
    { id: 9745, key: 'plasma' },
    { id: 42161, key: 'arbitrum' },
    { id: 43114, key: 'avax' },
    { id: 59144, key: 'linea' },
    { id: 80094, key: 'berachain' },
] as const;

export type Chain = (typeof CHAINS)[number];
export type ChainId = Chain['id'];
export type ChainKey = Chain['key'];

const BY_ID = new Map<number, Chain>(CHAINS.map((chain) => [chain.id, chain]));
const BY_KEY = new Map<string, Chain>(CHAINS.map((chain) => [chain.key, chain]));

export const chainById = (id: number): Chain | undefined => BY_ID.get(id);

export const chainByKey = (key: string): Chain | undefined => BY_KEY.get(key);

export const isChainId = (id: number): id is ChainId => BY_ID.has(id);
