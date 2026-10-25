import type { EvmChainId, Logger } from 'envio';
import {
    ContractFunctionExecutionError,
    createPublicClient,
    defineChain,
    http,
    type PublicClient,
    type Chain as ViemChain,
} from 'viem';
import {
    arbitrum,
    avalanche,
    base,
    berachain,
    bsc,
    fraxtal,
    gnosis,
    linea,
    lisk,
    mainnet,
    mantle,
    megaeth,
    metis,
    monad,
    optimism,
    plasma,
    polygon,
    robinhood,
    sei,
    sonic,
    zksync,
} from 'viem/chains';
import { RPC_URL } from './config';
import { createFixtureFetch, getRpcFixtureMode } from './rpcFixtures';

const hyperevm = defineChain({
    id: 999,
    name: 'HyperEVM',
    nativeCurrency: {
        decimals: 18,
        name: 'Hyperliquid',
        symbol: 'HYPE',
    },
    rpcUrls: {
        default: {
            http: ['https://rpc.hyperliquid.xyz/evm'],
            webSocket: ['wss://rpc.hyperliquid.xyz/evm'],
        },
    },
    blockExplorers: {
        default: { name: 'Explorer', url: 'https://www.hyperscan.com' },
    },
    contracts: {
        multicall3: {
            address: '0xcA11bde05977b3631167028862bE2a173976CA11',
            blockCreated: 13051,
        },
    },
});

const chainMap: Record<EvmChainId, ViemChain> = {
    42161: arbitrum,
    43114: avalanche,
    8453: base,
    80094: berachain,
    56: bsc,
    1: mainnet,
    252: fraxtal,
    100: gnosis,
    999: hyperevm,
    59144: linea,
    1135: lisk,
    5000: mantle,
    4326: megaeth,
    1088: metis,
    143: monad,
    10: optimism,
    9745: plasma,
    137: polygon,
    4663: robinhood,
    1329: sei,
    146: sonic,
    324: zksync,
};

// Max sub-calls merged into one aggregate3: keeps an eth_call under node gas caps (swapper
// quotes are the heaviest sub-calls); a lone group larger than this still runs as one call.
const MAX_CALLS_PER_AGGREGATE = 64;
// Window during which multicalls for the same block are collected into a shared eth_call.
const MULTICALL_MERGE_WAIT_MS = 16;
// Never let viem split a group: calls of one group must run in a single eth_call (see below).
const UNSPLIT = Number.MAX_SAFE_INTEGER;

const clients = new Map<EvmChainId, PublicClient>();

type MulticallParameters = Parameters<PublicClient['multicall']>[0];
type MulticallResultEntry = { status: 'success' | 'failure'; result?: unknown; error?: unknown };
type PendingGroup = {
    contracts: MulticallParameters['contracts'];
    resolve: (results: MulticallResultEntry[]) => void;
    reject: (error: unknown) => void;
};

/**
 * viem reports a failed aggregate3 request (gas cap, timeout, HTTP error) by giving every sub-call of the chunk
 * the same transport error. A sub-call that reverted or returned undecodable data gets its own
 * ContractFunctionExecutionError instead: that is the contract's answer and must not be retried.
 */
const isWholeRequestFailure = (results: MulticallResultEntry[]) => {
    const first = results[0];
    if (!first || first.status !== 'failure' || first.error instanceof ContractFunctionExecutionError) return false;
    return results.every((res) => res.status === 'failure' && res.error === first.error);
};

const packGroups = (groups: PendingGroup[]) => {
    const chunks: PendingGroup[][] = [];
    let current: PendingGroup[] = [];
    let size = 0;
    for (const group of groups) {
        if (current.length > 0 && size + group.contracts.length > MAX_CALLS_PER_AGGREGATE) {
            chunks.push(current);
            current = [];
            size = 0;
        }
        current.push(group);
        size += group.contracts.length;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
};

/** A block number, or `latest` for unpinned reads (one-time contract facts). */
type BlockKey = bigint | 'latest';

/**
 * Merges `multicall()` groups issued for the same block, or at `latest` (by concurrently processed
 * events and contracts), into shared aggregate3 eth_calls.
 *
 * A group is never split nor reordered: its sub-calls share one EVM execution, which the
 * state fetches rely on (`BeefyOracle.getFreshPrice` updates the oracle before the swapper
 * quotes that read it are executed). Groups are only concatenated, in arrival order.
 */
const createBlockMulticallBatcher = ({
    client,
    mergeGroups,
    deploylessAt,
}: {
    client: PublicClient;
    mergeGroups: boolean;
    deploylessAt: (blockNumber: bigint) => boolean;
}) => {
    const queues = new Map<BlockKey, PendingGroup[]>();

    const execute = async (block: BlockKey, groups: PendingGroup[], batchSize = UNSPLIT) => {
        const results = (await client.multicall({
            allowFailure: true,
            ...(block === 'latest' ? {} : { blockNumber: block }),
            batchSize,
            deployless: block !== 'latest' && deploylessAt(block),
            contracts: groups.flatMap((group) => [...group.contracts]) as MulticallParameters['contracts'],
        })) as MulticallResultEntry[];
        if (isWholeRequestFailure(results)) throw results[0]?.error;
        let offset = 0;
        for (const group of groups) {
            group.resolve(results.slice(offset, offset + group.contracts.length));
            offset += group.contracts.length;
        }
    };

    const executeWithFallback = async (blockNumber: BlockKey, groups: PendingGroup[]) => {
        try {
            return await execute(blockNumber, groups);
        } catch {
            // The shared request failed as a whole (gas cap, timeout): isolate each group, then
            // fall back to viem's default chunking for a group that can't run in one call.
            await Promise.all(
                groups.map(async (group) => {
                    try {
                        await execute(blockNumber, [group]);
                    } catch {
                        try {
                            await execute(blockNumber, [group], 1_024);
                        } catch (error) {
                            group.reject(error);
                        }
                    }
                })
            );
        }
    };

    const flush = (blockNumber: BlockKey) => {
        const groups = queues.get(blockNumber) ?? [];
        queues.delete(blockNumber);
        for (const chunk of packGroups(groups)) {
            void executeWithFallback(blockNumber, chunk);
        }
    };

    return (blockNumber: BlockKey, contracts: MulticallParameters['contracts']) =>
        new Promise<MulticallResultEntry[]>((resolve, reject) => {
            const group = { contracts, resolve, reject };
            // Fixture replay keys on the exact request, which merging would make timing-dependent.
            if (!mergeGroups) {
                void executeWithFallback(blockNumber, [group]);
                return;
            }
            const queue = queues.get(blockNumber);
            if (queue) {
                queue.push(group);
                return;
            }
            queues.set(blockNumber, [group]);
            setTimeout(() => flush(blockNumber), MULTICALL_MERGE_WAIT_MS);
        });
};

export const getViemClient = (chainId: EvmChainId, logger: Logger) => {
    const rpcUrl = RPC_URL[chainId];

    if (clients.has(chainId)) {
        return clients.get(chainId) as PublicClient;
    }

    const fixtureMode = getRpcFixtureMode();

    const transport = http(rpcUrl, {
        ...(fixtureMode !== 'off' ? { fetchFn: createFixtureFetch(chainId, fixtureMode) } : {}),
        onFetchRequest: async (request) => {
            const requestData = await request.clone().json();
            logger.debug('rpc.http: request', { request: requestData });
        },
        onFetchResponse: async (response) => {
            const responseData = await response.clone().json();
            logger.debug('rpc.http: response', { response: responseData });
        },
        // the RPC proxy (erpc) batches requests, and multicalls are merged by createBlockMulticallBatcher
        batch: false,
        // up to ~15.5 s of retries (500 ms doubling, 5 times)
        retryCount: 5,
        retryDelay: 500,
        // erpc handles upstream retries and fallbacks: wait longer for an answer rather than fail
        timeout: 30_000,
    });

    const baseClient = createPublicClient({
        chain: chainMap[chainId],
        // merging is done per multicall() group below, never per individual read
        batch: {
            multicall: false,
        },
        transport,
    });

    const blockCreated = baseClient.chain?.contracts?.multicall3?.blockCreated;
    const deploylessAt = (blockNumber: bigint) => blockCreated !== undefined && blockNumber < BigInt(blockCreated);
    const multicallAtBlock = createBlockMulticallBatcher({
        client: baseClient as PublicClient,
        mergeGroups: fixtureMode === 'off',
        deploylessAt,
    });

    const client = baseClient.extend((innerClient) => ({
        async multicall(parameters: Parameters<typeof innerClient.multicall>[0]) {
            type MulticallReturn = Awaited<ReturnType<typeof innerClient.multicall>>;
            const { blockNumber, contracts, allowFailure = true } = parameters;

            // Unpinned reads (immutable contract facts) share one `latest` queue.
            const results = await multicallAtBlock(blockNumber ?? 'latest', contracts);
            if (!allowFailure) {
                return results.map((res) => {
                    if (res.status === 'failure') throw res.error;
                    return res.result;
                }) as unknown as MulticallReturn;
            }
            return results as unknown as MulticallReturn;
        },
    }));

    clients.set(chainId, client);
    return client;
};
