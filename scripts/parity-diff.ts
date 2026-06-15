/**
 * Parity diff script: compare subgraph vs Envio indexer responses for pilot chains.
 *
 * Usage:
 *   SUBGRAPH_TAG=latest \
 *   ENVIO_GRAPHQL_URL=https://your-envio-hasura/v1/graphql \
 *   pnpm parity:diff arbitrum base bsc
 */
const SUBGRAPH_PROJECT = 'project_clu2walwem1qm01w40v3yhw1f';
const SUBGRAPH_TAG = process.env.SUBGRAPH_TAG ?? 'latest';
const ENVIO_URL = process.env.ENVIO_GRAPHQL_URL;

const CHAIN_NUMERIC_IDS: Record<string, number> = {
    arbitrum: 42161,
    base: 8453,
    bsc: 56,
    avax: 43114,
    ethereum: 1,
    optimism: 10,
    polygon: 137,
};

const subgraphUrl = (chain: string) =>
    `https://api.goldsky.com/api/public/${SUBGRAPH_PROJECT}/subgraphs/beefy-clm-${chain}/${SUBGRAPH_TAG}/gn`;

const toVaultId = (chain: string, address: string) => `${CHAIN_NUMERIC_IDS[chain]}-${address.toLowerCase()}`;

const graphqlRequest = async <T>(url: string, query: string, variables: Record<string, unknown>): Promise<T> => {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as { data?: T; errors?: unknown[] };
    if (json.errors?.length) {
        throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    if (!json.data) {
        throw new Error('GraphQL response missing data');
    }

    return json.data;
};

const SUBGRAPH_VAULTS = `
    query Vaults($since: BigInt!) {
        clms(first: 5, where: { lifecycle_not: INITIALIZING }) {
            id
            managerTotalSupply
            token0ToNativePrice
            token1ToNativePrice
            nativeToUSDPrice
        }
        classics(first: 5, where: { lifecycle_not: INITIALIZING }) {
            id
            vaultSharesTotalSupply
            underlyingToNativePrice
            nativeToUSDPrice
        }
    }
`;

const ENVIO_VAULTS = `
    query Vaults($chainId: Int!, $since: timestamp!) {
        Clm(
            limit: 5
            where: {
                chainId: { _eq: $chainId }
                initializableStatus: { _neq: "INITIALIZING" }
            }
        ) {
            id
            managerTotalSupply
            token0ToNativePrice
            token1ToNativePrice
            nativeToUSDPrice
        }
        Classic(
            limit: 5
            where: {
                chainId: { _eq: $chainId }
                initializableStatus: { _neq: "INITIALIZING" }
            }
        ) {
            id
            vaultTokenTotalSupply
            underlyingToNativePrice
            nativeToUSDPrice
        }
    }
`;

type DiffResult = {
    chain: string;
    clmCountSubgraph: number;
    clmCountEnvio: number;
    classicCountSubgraph: number;
    classicCountEnvio: number;
    mismatches: string[];
};

const compareVaultLists = async (chain: string): Promise<DiffResult> => {
    if (!ENVIO_URL) {
        throw new Error('ENVIO_GRAPHQL_URL is required');
    }

    const chainId = CHAIN_NUMERIC_IDS[chain];
    if (!chainId) {
        throw new Error(`Unknown chain: ${chain}`);
    }

    const since = Math.floor(Date.now() / 1000) - 86400 * 30;

    const [subgraphRes, envioRes] = await Promise.all([
        graphqlRequest<{
            clms: Array<Record<string, string>>;
            classics: Array<Record<string, string>>;
        }>(subgraphUrl(chain), SUBGRAPH_VAULTS, { since: since.toString() }),
        graphqlRequest<{
            Clm: Array<Record<string, string>>;
            Classic: Array<Record<string, string>>;
        }>(ENVIO_URL, ENVIO_VAULTS, { chainId, since: new Date(since * 1000).toISOString() }),
    ]);

    const mismatches: string[] = [];

    const subgraphClmIds = new Set(subgraphRes.clms.map((c) => toVaultId(chain, c.id.replace(/^0x/i, '0x'))));
    const envioClmIds = new Set(envioRes.Clm.map((c) => c.id));

    for (const id of subgraphClmIds) {
        if (!envioClmIds.has(id)) {
            mismatches.push(`CLM missing in Envio: ${id}`);
        }
    }
    for (const id of envioClmIds) {
        if (!subgraphClmIds.has(id)) {
            mismatches.push(`CLM extra in Envio: ${id}`);
        }
    }

    const subgraphClassicIds = new Set(subgraphRes.classics.map((c) => toVaultId(chain, c.id.replace(/^0x/i, '0x'))));
    const envioClassicIds = new Set(envioRes.Classic.map((c) => c.id));

    for (const id of subgraphClassicIds) {
        if (!envioClassicIds.has(id)) {
            mismatches.push(`Classic missing in Envio: ${id}`);
        }
    }

    return {
        chain,
        clmCountSubgraph: subgraphRes.clms.length,
        clmCountEnvio: envioRes.Clm.length,
        classicCountSubgraph: subgraphRes.classics.length,
        classicCountEnvio: envioRes.Classic.length,
        mismatches,
    };
};

const main = async () => {
    const chains = process.argv.slice(2);
    if (chains.length === 0) {
        console.error('Usage: pnpm parity:diff <chain> [chain...]');
        process.exit(1);
    }

    console.log(`Comparing subgraph (tag=${SUBGRAPH_TAG}) vs Envio (${ENVIO_URL})`);
    console.log('---');

    let totalMismatches = 0;

    for (const chain of chains) {
        try {
            const result = await compareVaultLists(chain);
            console.log(`[${chain}] CLMs: subgraph=${result.clmCountSubgraph} envio=${result.clmCountEnvio}`);
            console.log(
                `[${chain}] Classics: subgraph=${result.classicCountSubgraph} envio=${result.classicCountEnvio}`
            );
            if (result.mismatches.length > 0) {
                console.log(`[${chain}] Mismatches:`);
                for (const m of result.mismatches) {
                    console.log(`  - ${m}`);
                }
                totalMismatches += result.mismatches.length;
            } else {
                console.log(`[${chain}] OK — vault IDs match`);
            }
        } catch (e) {
            console.error(`[${chain}] ERROR:`, e);
            totalMismatches += 1;
        }
        console.log('---');
    }

    process.exit(totalMismatches > 0 ? 1 : 0);
};

main();
