/**
 * Beefy API catalog, normalized onto indexer `Contract` ids (`chainId-address`).
 *
 * `/vaults` is the classic vault list (including CLM wrappers). Managers come from
 * `/cow-vaults`, gov/reward pools from `/gov-vaults`, and launchpool boosts from `/boosts`.
 * LST contracts and swappers are not separate API types; the expected sets are
 * the uncommented `LstVault` and `BeefySwapper` addresses in config.yaml.
 *
 * API answers are validated (zod): an entry of the wrong shape is dropped and logged, an answer that is not a list
 * fails the fetch. Imported by scripts/knownContracts.ts under node's type stripping: imports carry their extension.
 */
import * as R from 'remeda';
import { zeroAddress } from 'viem';
import { z } from 'zod';

import { fetchWithRetry, type RetryOptions } from '../../src/lib/fetch.ts';

/** Product category of the catalog; indexed as `Contract` rows of the kinds in `ENTITY_KINDS`. */
export type IndexedEntity = 'Classic' | 'Clm' | 'RewardPool' | 'ClassicBoost' | 'LstVault' | 'Swapper';

/** `Contract.kind` values that satisfy a catalog product of each category. */
const ENTITY_KINDS: Record<IndexedEntity, readonly string[]> = {
    Classic: ['VAULT'],
    Clm: ['CLM_MANAGER'],
    // the gov-vaults list includes old gov vaults, indexed as launchpool-style boosts
    RewardPool: ['REWARD_POOL', 'BOOST'],
    ClassicBoost: ['BOOST'],
    LstVault: ['LST_VAULT'],
    Swapper: ['SWAPPER'],
};

const COVERAGE_ENTITIES: readonly IndexedEntity[] = [
    'Classic',
    'Clm',
    'RewardPool',
    'ClassicBoost',
    'LstVault',
    'Swapper',
];

/** `Contract.kind` values that satisfy a catalog product of `entity`. */
export const entityKinds = (entity: IndexedEntity): readonly string[] => ENTITY_KINDS[entity];

/** Every catalog category, in report order. */
export const coverageEntities = (): readonly IndexedEntity[] => COVERAGE_ENTITIES;

export type CatalogProduct = {
    entity: IndexedEntity;
    /** Indexer id: `${chainId}-${lowercaseAddress}` */
    id: string;
    chainId: number;
    address: string;
    beefyId: string;
    status: string;
    /** Missing active/paused products fail the audit. EOL and closed are warnings. */
    live: boolean;
};

/** Beefy `chain` / `network` name → EVM chain id. */
const BEEFY_NETWORK_TO_CHAIN_ID: Readonly<Record<string, number>> = {
    arbitrum: 42161,
    arc: 5042,
    aurora: 1313161554,
    avax: 43114,
    base: 8453,
    berachain: 80094,
    bsc: 56,
    canto: 7700,
    celo: 42220,
    cronos: 25,
    emerald: 42262,
    ethereum: 1,
    fantom: 250,
    fraxtal: 252,
    fuse: 122,
    gnosis: 100,
    harmony: 1666600000,
    heco: 128,
    hyperevm: 999,
    kava: 2222,
    linea: 59144,
    lisk: 1135,
    manta: 169,
    mantle: 5000,
    megaeth: 4326,
    metis: 1088,
    mode: 34443,
    monad: 143,
    moonbeam: 1284,
    moonriver: 1285,
    one: 1666600000,
    optimism: 10,
    plasma: 9745,
    polygon: 137,
    real: 111188,
    robinhood: 4663,
    rootstock: 30,
    saga: 5464,
    scroll: 534352,
    sei: 1329,
    sonic: 146,
    zkevm: 1101,
    zksync: 324,
};

/** Every Beefy network name and its chain id. */
export const beefyNetworkChainIds = (): Readonly<Record<string, number>> => BEEFY_NETWORK_TO_CHAIN_ID;

export const productId = (chainId: number, address: string) => `${chainId}-${address.toLowerCase()}`;

export const isLiveStatus = (status: string | undefined) => {
    const normalized = (status ?? 'active').toLowerCase();
    return normalized === 'active' || normalized === 'paused';
};

/** `  - id: <chainId>` entries under `chains` in config.yaml. */
export const loadActiveChainIds = (configYaml: string): number[] => {
    const ids: number[] = [];
    for (const line of configYaml.split('\n')) {
        const match = line.match(/^ {2}- id: (\d+)\b/);
        if (match?.[1]) {
            ids.push(Number(match[1]));
        }
    }
    return ids;
};

/**
 * `{chainId, address}` pairs from `rawVaultBlacklist` in src/lib/blacklist.ts (read as text: that module's imports do
 * not resolve under node's type stripping).
 */
export const loadVaultBlacklist = (source: string): Array<{ chainId: number; address: string }> => {
    const start = source.indexOf('const rawVaultBlacklist');
    const end = source.indexOf('const vaultBlacklist', start);
    if (start < 0 || end < 0) {
        throw new Error('Could not locate rawVaultBlacklist in src/lib/blacklist.ts');
    }
    const slice = source.slice(start, end);
    const entries: Array<{ chainId: number; address: string }> = [];
    for (const match of slice.matchAll(/chainId:\s*(\d+),\s*address:\s*'([^']+)'/g)) {
        const chainId = Number(match[1]);
        const address = match[2]?.toLowerCase();
        if (address) {
            entries.push({ chainId, address });
        }
    }
    return entries;
};

/**
 * Uncommented contract addresses for `contractName`, associated with the enclosing chain id.
 * Commented chains and commented address lines are ignored.
 */
export const loadConfiguredContracts = (
    configYaml: string,
    contractName: string
): Array<{ chainId: number; address: string }> => {
    if (!/^\w+$/.test(contractName)) throw new Error(`invalid contract name: ${JSON.stringify(contractName)}`);
    const namePattern = new RegExp(`\\s-\\sname:\\s+${contractName}\\b`);
    const entries: Array<{ chainId: number; address: string }> = [];
    let chainId: number | null = null;
    let inContract = false;

    for (const line of configYaml.split('\n')) {
        if (/^\s*#/.test(line)) {
            continue;
        }
        const chainMatch = line.match(/^ {2}- id: (\d+)\b/);
        if (chainMatch?.[1]) {
            chainId = Number(chainMatch[1]);
            inContract = false;
            continue;
        }
        if (chainId == null) {
            continue;
        }
        if (/\s-\sname:\s+\S+/.test(line)) {
            inContract = namePattern.test(line);
            continue;
        }
        if (!inContract) {
            continue;
        }
        const addressMatch = line.match(/-\s*(0x[a-fA-F0-9]{40})\b/);
        if (addressMatch?.[1]) {
            entries.push({ chainId, address: addressMatch[1].toLowerCase() });
        }
    }
    return entries;
};

const ADDRESSBOOK_CONFIG_FACTORIES = [
    { contract: 'ClassicVaultFactory', field: 'vaultFactory' },
    { contract: 'ClassicStrategyFactory', field: 'strategyFactory' },
    { contract: 'ClmManagerFactory', field: 'clmFactory' },
    { contract: 'ClmStrategyFactory', field: 'clmStrategyFactory' },
    { contract: 'RewardPoolFactory', field: 'clmRewardPoolFactory' },
    { contract: 'Erc4626AdapterFactory', field: 'wrapperFactory' },
    { contract: 'BeefySwapper', field: 'beefySwapper' },
] as const;

/** The config.yaml factory contracts and the addressbook field each one's address comes from. */
export const addressbookConfigFactories = () => ADDRESSBOOK_CONFIG_FACTORIES;

export const isConfiguredAddress = (address: string | undefined): address is string =>
    Boolean(address && address.toLowerCase() !== zeroAddress);

/** Uncommented LstVault contract addresses, associated with the enclosing chain id. */
export const loadConfiguredLstVaults = (configYaml: string): Array<{ chainId: number; address: string }> =>
    loadConfiguredContracts(configYaml, 'LstVault');

/** Uncommented BeefySwapper contract addresses, associated with the enclosing chain id. */
export const loadConfiguredSwappers = (configYaml: string): Array<{ chainId: number; address: string }> =>
    loadConfiguredContracts(configYaml, 'BeefySwapper');

const optionalAddress = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .nullish();

/** The fields this repo reads from the Beefy API product lists; an entry with any of them malformed is dropped. */
const beefyApiProductSchema = z.object({
    id: z.string().optional(),
    chain: z.string().optional(),
    network: z.string().optional(),
    status: z.string().optional(),
    earnContractAddress: optionalAddress,
    /** current strategy (`/vaults`, `/cow-vaults`) */
    strategy: optionalAddress,
    /** `/gov-vaults`: 2 = reward pool, unset = launchpool-style gov vault; `/boosts`: launchpool version */
    version: z.number().int().nullish(),
});

export type BeefyApiProduct = z.infer<typeof beefyApiProductSchema>;

export type BeefyApiLists = {
    /** classic vaults (including CLM wrappers) */
    vaults: BeefyApiProduct[];
    /** CLM managers */
    cows: BeefyApiProduct[];
    /** reward pools and old gov vaults */
    govs: BeefyApiProduct[];
    /** launchpool boosts */
    boosts: BeefyApiProduct[];
};

/** `path` of the API: a list whose valid products are kept; a failed request or a non-list answer throws. */
const fetchProducts = async (
    apiUrl: string,
    path: string,
    onInvalid: (message: string) => void,
    retry: RetryOptions
): Promise<BeefyApiProduct[]> => {
    const url = new URL(path, `${apiUrl.replace(/\/+$/, '')}/`);
    const response = await fetchWithRetry(
        url,
        { headers: { accept: 'application/json', 'user-agent': 'beefy-envio-indexer' } },
        retry
    );
    if (!response.ok) {
        throw new Error(`GET ${url.href} failed: ${response.status} ${response.statusText}`);
    }
    const list = z.array(z.unknown()).safeParse(await response.json());
    if (!list.success) throw new Error(`GET ${url.href}: expected a list`);
    const results = R.map(list.data, (entry) => beefyApiProductSchema.safeParse(entry));
    const valid = R.pipe(
        results,
        R.filter((result) => result.success),
        R.map((result) => result.data)
    );
    if (valid.length < results.length)
        onInvalid(`GET ${url.href}: dropped ${results.length - valid.length} invalid entries`);
    return valid;
};

const addProduct = (products: Map<string, CatalogProduct>, product: CatalogProduct) => {
    const key = `${product.entity}:${product.id}`;
    const existing = products.get(key);
    if (!existing || (!existing.live && product.live)) {
        products.set(key, product);
    }
};

const collectVaults = (
    products: Map<string, CatalogProduct>,
    rows: BeefyApiProduct[],
    entity: IndexedEntity,
    chainIds: Set<number>
) => {
    for (const row of rows) {
        const chainId = apiChainId(row);
        const address = row.earnContractAddress;
        if (chainId == null || !chainIds.has(chainId) || !address || !address.startsWith('0x')) {
            continue;
        }
        const status = row.status ?? 'active';
        addProduct(products, {
            entity,
            id: productId(chainId, address),
            chainId,
            address: address.toLowerCase(),
            beefyId: row.id ?? address,
            status,
            live: isLiveStatus(status),
        });
    }
};

/** `/vaults`, `/cow-vaults`, `/gov-vaults`, `/boosts` of the API at `apiUrl` (BEEFY_API_URL). */
export const fetchBeefyApiLists = async (
    apiUrl: string,
    onInvalid: (message: string) => void = (message) => console.warn(message),
    retry: RetryOptions = {}
): Promise<BeefyApiLists> => {
    const [vaults, cows, govs, boosts] = await Promise.all([
        fetchProducts(apiUrl, 'vaults', onInvalid, retry),
        fetchProducts(apiUrl, 'cow-vaults', onInvalid, retry),
        fetchProducts(apiUrl, 'gov-vaults', onInvalid, retry),
        fetchProducts(apiUrl, 'boosts', onInvalid, retry),
    ]);
    return { vaults, cows, govs, boosts };
};

/** Chain id of an API product, when the network is known. */
export const apiChainId = (product: BeefyApiProduct): number | undefined => {
    const network = product.chain ?? product.network;
    // own keys only: a network named `__proto__` or `constructor` is unknown, not an object
    return network !== undefined && Object.hasOwn(BEEFY_NETWORK_TO_CHAIN_ID, network)
        ? BEEFY_NETWORK_TO_CHAIN_ID[network]
        : undefined;
};

export const fetchCatalog = async (
    chainIds: readonly number[],
    apiUrl: string,
    onInvalid?: (message: string) => void,
    retry?: RetryOptions
): Promise<CatalogProduct[]> => {
    const selected = new Set(chainIds);
    const { vaults, cows, govs, boosts } = await fetchBeefyApiLists(apiUrl, onInvalid, retry);

    const products = new Map<string, CatalogProduct>();
    collectVaults(products, vaults, 'Classic', selected);
    collectVaults(products, cows, 'Clm', selected);
    collectVaults(products, govs, 'RewardPool', selected);
    collectVaults(products, boosts, 'ClassicBoost', selected);
    return [...products.values()];
};

const configuredProducts = (
    entries: Array<{ chainId: number; address: string }>,
    chainIds: readonly number[],
    entity: IndexedEntity,
    beefyId: string
): CatalogProduct[] => {
    const selected = new Set(chainIds);
    return entries
        .filter((entry) => selected.has(entry.chainId))
        .map((entry) => ({
            entity,
            id: productId(entry.chainId, entry.address),
            chainId: entry.chainId,
            address: entry.address,
            beefyId,
            status: 'configured',
            live: true,
        }));
};

export const configuredLstProducts = (configYaml: string, chainIds: readonly number[]): CatalogProduct[] =>
    configuredProducts(loadConfiguredLstVaults(configYaml), chainIds, 'LstVault', 'config.yaml LstVault');

export const configuredSwapperProducts = (configYaml: string, chainIds: readonly number[]): CatalogProduct[] =>
    configuredProducts(loadConfiguredSwappers(configYaml), chainIds, 'Swapper', 'config.yaml BeefySwapper');
