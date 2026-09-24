/**
 * Beefy API catalog, normalized onto indexer entity ids (`chainId-address`).
 *
 * `/vaults` is the classic vault list (including CLM wrappers). Managers come from
 * `/cow-vaults`, gov/reward pools from `/gov-vaults`, and launchpool boosts from `/boosts`.
 * LST contracts and swappers are not separate API types; the expected sets are
 * the uncommented `LstVault` and `BeefySwapper` addresses in config.yaml.
 */

export type IndexedEntity = 'Classic' | 'Clm' | 'RewardPool' | 'ClassicBoost' | 'LstVault' | 'Swapper';

export const COVERAGE_ENTITIES: IndexedEntity[] = [
    'Classic',
    'Clm',
    'RewardPool',
    'ClassicBoost',
    'LstVault',
    'Swapper',
];

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

export const BEEFY_API_URL = 'https://api.beefy.finance';

/** Beefy `chain` / `network` name → EVM chain id. */
export const BEEFY_NETWORK_TO_CHAIN_ID: Record<string, number> = {
    arbitrum: 42161,
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

export const productId = (chainId: number, address: string) => `${chainId}-${address.toLowerCase()}`;

export const isLiveStatus = (status: string | undefined) => {
    const normalized = (status ?? 'active').toLowerCase();
    return normalized === 'active' || normalized === 'paused';
};

/** Uncommented `  - id: <chainId>` entries under `networks` in config.yaml. */
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

/** `{chainId, address}` pairs from `rawVaultBlacklist` only (not the account blacklist). */
export const loadVaultBlacklist = (source: string): Array<{ chainId: number; address: string }> => {
    const start = source.indexOf('export const rawVaultBlacklist');
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

export const ADDRESSBOOK_CONFIG_FACTORIES = [
    { contract: 'ClassicVaultFactory', field: 'vaultFactory' },
    { contract: 'ClassicStrategyFactory', field: 'strategyFactory' },
    { contract: 'ClmManagerFactory', field: 'clmFactory' },
    { contract: 'ClmStrategyFactory', field: 'clmStrategyFactory' },
    { contract: 'RewardPoolFactory', field: 'clmRewardPoolFactory' },
    { contract: 'Erc4626AdapterFactory', field: 'wrapperFactory' },
    { contract: 'BeefySwapper', field: 'beefySwapper' },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const isConfiguredAddress = (address: string | undefined): address is string =>
    Boolean(address && address.toLowerCase() !== ZERO_ADDRESS);

/** Uncommented LstVault contract addresses, associated with the enclosing chain id. */
export const loadConfiguredLstVaults = (configYaml: string): Array<{ chainId: number; address: string }> =>
    loadConfiguredContracts(configYaml, 'LstVault');

/** Uncommented BeefySwapper contract addresses, associated with the enclosing chain id. */
export const loadConfiguredSwappers = (configYaml: string): Array<{ chainId: number; address: string }> =>
    loadConfiguredContracts(configYaml, 'BeefySwapper');

type BeefyVault = {
    id?: string;
    chain?: string;
    network?: string;
    status?: string;
    earnContractAddress?: string | null;
};

type BeefyBoost = {
    id?: string;
    chain?: string;
    status?: string;
    earnContractAddress?: string | null;
};

const fetchJson = async <T>(url: string): Promise<T> => {
    const response = await fetch(url, {
        headers: {
            accept: 'application/json',
            'user-agent': 'beefy-envio-integrity',
        },
    });
    if (!response.ok) {
        throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
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
    rows: BeefyVault[],
    entity: IndexedEntity,
    chainIds: Set<number>
) => {
    for (const row of rows) {
        const network = row.chain ?? row.network;
        const chainId = network ? BEEFY_NETWORK_TO_CHAIN_ID[network] : undefined;
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

export const fetchCatalog = async (chainIds: number[], apiUrl = BEEFY_API_URL): Promise<CatalogProduct[]> => {
    const selected = new Set(chainIds);
    const [vaults, cows, govs, boosts] = await Promise.all([
        fetchJson<BeefyVault[]>(`${apiUrl}/vaults`),
        fetchJson<BeefyVault[]>(`${apiUrl}/cow-vaults`),
        fetchJson<BeefyVault[]>(`${apiUrl}/gov-vaults`),
        fetchJson<BeefyBoost[]>(`${apiUrl}/boosts`),
    ]);

    const products = new Map<string, CatalogProduct>();
    collectVaults(products, vaults, 'Classic', selected);
    collectVaults(products, cows, 'Clm', selected);
    collectVaults(products, govs, 'RewardPool', selected);
    collectVaults(products, boosts, 'ClassicBoost', selected);
    return [...products.values()];
};

const configuredProducts = (
    entries: Array<{ chainId: number; address: string }>,
    chainIds: number[],
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

export const configuredLstProducts = (configYaml: string, chainIds: number[]): CatalogProduct[] =>
    configuredProducts(loadConfiguredLstVaults(configYaml), chainIds, 'LstVault', 'config.yaml LstVault');

export const configuredSwapperProducts = (configYaml: string, chainIds: number[]): CatalogProduct[] =>
    configuredProducts(loadConfiguredSwappers(configYaml), chainIds, 'Swapper', 'config.yaml BeefySwapper');
