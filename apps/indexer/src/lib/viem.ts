import type { EvmChainId, Logger } from 'envio';
import {
    BaseError,
    ContractFunctionRevertedError,
    ContractFunctionZeroDataError,
    createPublicClient,
    defineChain,
    HttpRequestError,
    http,
    type PublicClient,
    TimeoutError,
    type Chain as ViemChain,
} from 'viem';
import {
    arbitrum,
    arc,
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

import { indexerConfig } from './config';
import { describeError } from './errors';
import { createFixtureFetch } from './rpcFixtures';

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
    5042: arc,
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

// Merging knobs (src/lib/config.ts): RPC_MULTICALL_MAX_CALLS keeps an eth_call under node gas caps (swapper quotes
// are the heaviest sub-calls), RPC_MULTICALL_MERGE_WAIT_MS is the window during which multicalls for the same block are
// collected into a shared eth_call.
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

/** A sub-call's own answer: it reverted, or returned no data (no code, or out of gas). */
const isContractAnswer = (error: unknown) =>
    error instanceof BaseError &&
    error.walk(
        (cause) => cause instanceof ContractFunctionRevertedError || cause instanceof ContractFunctionZeroDataError
    ) !== null;

/**
 * viem reports a failed aggregate3 request (rate limit, gas cap, timeout, HTTP error) by giving every sub-call of the
 * chunk the same error object, which `readContract` has wrapped in a ContractFunctionExecutionError like a revert. A
 * sub-call that reverted or returned undecodable data gets its own error object instead: that is the contract's answer
 * and must not be retried. One shared object over several sub-calls is therefore a failed request; for a lone sub-call,
 * the cause tells them apart.
 */
const isWholeRequestFailure = (results: MulticallResultEntry[]) => {
    const first = results[0];
    if (!first || first.status !== 'failure') return false;
    if (!results.every((res) => res.status === 'failure' && res.error === first.error)) return false;
    return results.length > 1 || !isContractAnswer(first.error);
};

/** The longest wait between two attempts at a group during an RPC outage. */
const OUTAGE_MAX_DELAY_MS = 60_000;

/** The request got no answer, or the node could not serve it for now: a later attempt can get through. */
const isOutage = (error: unknown) =>
    error instanceof BaseError &&
    error.walk(
        (cause) =>
            cause instanceof TimeoutError ||
            (cause instanceof HttpRequestError &&
                (cause.status === undefined || cause.status === 408 || cause.status >= 500))
    ) !== null;

const packGroups = (groups: PendingGroup[], maxCalls: number) => {
    const chunks: PendingGroup[][] = [];
    let current: PendingGroup[] = [];
    let size = 0;
    for (const group of groups) {
        if (current.length > 0 && size + group.contracts.length > maxCalls) {
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
    maxCalls,
    mergeWaitMs,
    retryDelayMs,
    logger,
}: {
    client: PublicClient;
    mergeGroups: boolean;
    deploylessAt: (blockNumber: bigint) => boolean;
    maxCalls: number;
    mergeWaitMs: number;
    retryDelayMs: number;
    logger: Logger;
}) => {
    const queues = new Map<BlockKey, PendingGroup[]>();

    const execute = async (block: BlockKey, groups: PendingGroup[], batchSize = UNSPLIT) => {
        const results = (await client.multicall({
            allowFailure: true,
            ...(block === 'latest' ? {} : { blockNumber: block }),
            batchSize,
            deployless: block !== 'latest' && deploylessAt(block),
            // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- tsc needs it: flatMap widens to unknown[]
            contracts: groups.flatMap((group) => [...group.contracts]) as MulticallParameters['contracts'],
        })) as MulticallResultEntry[];
        if (isWholeRequestFailure(results)) throw results[0]?.error;
        let offset = 0;
        for (const group of groups) {
            group.resolve(results.slice(offset, offset + group.contracts.length));
            offset += group.contracts.length;
        }
    };

    /**
     * One group, on its own. A throw in an effect stops the indexer, and the block range can't be retried by Envio once
     * its handler runs, so an RPC outage is waited out here, for as long as it lasts: `chain-stalled` reports it.
     */
    const executeGroup = async (blockNumber: BlockKey, group: PendingGroup) => {
        for (let attempt = 0; ; attempt += 1) {
            try {
                await execute(blockNumber, [group]);
                return;
            } catch {
                try {
                    // viem's default chunking, for a group that can't run in one call
                    await execute(blockNumber, [group], 1_024);
                    return;
                } catch (error) {
                    if (!isOutage(error)) {
                        group.reject(error);
                        return;
                    }
                    const delayMs = Math.min(retryDelayMs * 2 ** attempt, OUTAGE_MAX_DELAY_MS);
                    logger.warn('RPC outage, retrying the read', {
                        block: String(blockNumber),
                        attempt,
                        delayMs,
                        error: describeError(error),
                    });
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }
        }
    };

    const executeWithFallback = async (blockNumber: BlockKey, groups: PendingGroup[]) => {
        try {
            return await execute(blockNumber, groups);
        } catch {
            // The shared request failed as a whole (gas cap, timeout): isolate each group.
            await Promise.all(groups.map((group) => executeGroup(blockNumber, group)));
        }
    };

    const flush = (blockNumber: BlockKey) => {
        const groups = queues.get(blockNumber) ?? [];
        queues.delete(blockNumber);
        for (const chunk of packGroups(groups, maxCalls)) {
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
            setTimeout(() => flush(blockNumber), mergeWaitMs);
        });
};

export const getViemClient = (chainId: EvmChainId, logger: Logger) => {
    if (clients.has(chainId)) {
        return clients.get(chainId) as PublicClient;
    }

    const config = indexerConfig();
    // unset only under vitest: a missing fixture is then recorded from the chain's public RPC
    const rpcUrl = config.rpcUrls.get(chainId);
    const fixtureMode = config.rpcFixtures;

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
        // defaults: up to ~15.5 s of retries (500 ms doubling, 5 times), and a 30 s timeout (erpc handles upstream
        // retries and fallbacks: wait longer for an answer rather than fail)
        retryCount: config.rpc.retryCount,
        retryDelay: config.rpc.retryDelayMs,
        timeout: config.rpc.timeoutMs,
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
        client: baseClient,
        mergeGroups: fixtureMode === 'off',
        deploylessAt,
        maxCalls: config.rpc.multicallMaxCalls,
        mergeWaitMs: config.rpc.multicallMergeWaitMs,
        retryDelayMs: config.rpc.retryDelayMs,
        logger,
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
                });
            }
            return results as unknown as MulticallReturn;
        },
    }));

    clients.set(chainId, client);
    return client;
};
