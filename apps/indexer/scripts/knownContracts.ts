/**
 * Known Beefy contracts, listed as static addresses in config.yaml so a fresh index starts each chain with a few
 * address partitions instead of one per factory registration block (docs/architecture.md, "Known contracts").
 *
 * Candidates come from the Beefy API (`/vaults`, `/cow-vaults`, `/gov-vaults`, `/boosts`), which is never trusted
 * alone: every candidate's kind is verified on chain at `latest` (batched multicalls, two rounds per chain) with the
 * classification the factory handlers use (src/lib/classify.ts) plus the links that tie a product together. Only
 * confirmed contracts are kept; rejections are printed. Blacklisted contracts (src/lib/blacklist.ts) are skipped.
 *
 * The result replaces the `# generated` blocks of config.yaml (sorted, deterministic). Changing static addresses changes the stored config, which requires a reindex: run this only when
 * planning one, and commit the result. Chains whose reads fail keep their current list.
 *
 * Usage: pnpm known-contracts [chainId ...]   (default: every chain in config.yaml; needs ENVIO_RPC_URL_<chainId>)
 *        pnpm known-contracts --help
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';
import * as R from 'remeda';
import { createPublicClient, type Hex, http, parseAbi, zeroAddress } from 'viem';
import { z } from 'zod';

import { classifyClassicProxyReads } from '../src/lib/classify.ts';
import { describeError } from '../src/lib/errors.ts';
import {
    apiChainId,
    type BeefyApiLists,
    fetchBeefyApiLists,
    loadActiveChainIds,
    loadVaultBlacklist,
} from './integrity/catalog.ts';
import {
    configFileName,
    extractKnownContracts,
    type KnownAddresses,
    type KnownContract,
    type KnownKind,
    knownAddresses,
    mergeKnownContracts,
} from './knownConfig.ts';
import { chainIdArg } from './lib/cli.ts';
import { scriptsConfig } from './lib/config.ts';

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const CALLS_PER_MULTICALL = 500;
const PARALLEL_MULTICALLS = 4;

// ---------------------------------------------------------------------------------------------------------------------
// Candidates (Beefy API)
// ---------------------------------------------------------------------------------------------------------------------

/** What the API claims an address is, with the strategy it names (vaults, CLM managers). */
export type Candidate = {
    chainId: number;
    address: string;
    expected: 'VAULT' | 'CLM_MANAGER' | 'REWARD_POOL' | 'BOOST';
    apiStrategy?: string;
};

const isAddress = (value: string | null | undefined): value is string =>
    typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);

/**
 * `/vaults` -> VAULT (+ strategy), `/cow-vaults` -> CLM_MANAGER (+ strategy), `/gov-vaults` version 2 -> REWARD_POOL,
 * older gov vaults and `/boosts` -> BOOST (launchpool contracts). Unique per (chain, address, expected kind).
 */
export const candidatesFromApi = (lists: BeefyApiLists, chainIds: readonly number[]): Candidate[] =>
    R.pipe(
        [
            ...R.map(lists.vaults, (product) => ({ product, expected: 'VAULT' as const })),
            ...R.map(lists.cows, (product) => ({ product, expected: 'CLM_MANAGER' as const })),
            ...R.map(lists.govs, (product) => ({
                product,
                expected: product.version === 2 ? ('REWARD_POOL' as const) : ('BOOST' as const),
            })),
            ...R.map(lists.boosts, (product) => ({ product, expected: 'BOOST' as const })),
        ],
        R.map(({ product, expected }) => ({ chainId: apiChainId(product), product, expected })),
        R.filter(
            (entry): entry is typeof entry & { chainId: number } =>
                entry.chainId !== undefined &&
                chainIds.includes(entry.chainId) &&
                isAddress(entry.product.earnContractAddress)
        ),
        R.map(({ chainId, product, expected }): Candidate => ({
            chainId,
            address: (product.earnContractAddress as string).toLowerCase(),
            expected,
            ...(isAddress(product.strategy) ? { apiStrategy: product.strategy.toLowerCase() } : {}),
        })),
        R.uniqueBy((candidate) => `${candidate.chainId}-${candidate.address}-${candidate.expected}`),
        R.sortBy(
            (candidate) => candidate.chainId,
            (candidate) => candidate.address
        )
    );

// ---------------------------------------------------------------------------------------------------------------------
// Verification (pure)
// ---------------------------------------------------------------------------------------------------------------------

/** Result of the detection calls on one address: the returned address, or null when the call failed. */
export type Reads = {
    vault: string | null;
    strategy: string | null;
    rewardToken: string | null;
    stakedToken: string | null;
    wants: readonly [string, string] | null;
};

const READ_FUNCTIONS = ['vault', 'strategy', 'rewardToken', 'stakedToken', 'wants'] as const;

export type ReadFunction = (typeof READ_FUNCTIONS)[number];

/** The detection calls made on every address, in order. */
export const readFunctions = (): readonly ReadFunction[] => READ_FUNCTIONS;

const nonZero = (value: string | null | undefined): string | undefined =>
    value && value.toLowerCase() !== zeroAddress ? value.toLowerCase() : undefined;

const classicKind = (reads: Reads | undefined) =>
    reads
        ? classifyClassicProxyReads({
              vault: reads.vault !== null,
              strategy: reads.strategy !== null,
              rewardToken: reads.rewardToken !== null,
          })
        : 'UNKNOWN';

/** A strategy of `product` (classic vault or CLM manager): a classic strategy / any contract whose vault() is it. */
const pointsBack = (reads: Reads | undefined, product: string, classic: boolean) =>
    reads !== undefined && nonZero(reads.vault) === product && (!classic || classicKind(reads) === 'STRATEGY');

/**
 * Staking contracts: a reward pool answers `stakedToken()` and none of the classic detection calls; a boost
 * (launchpool) is classified as a boost (only `rewardToken()` answers) and has a `stakedToken()`.
 */
const stakingKind = (reads: Reads): 'REWARD_POOL' | 'BOOST' | undefined => {
    if (!nonZero(reads.stakedToken)) return undefined;
    if (reads.vault === null && reads.strategy === null && reads.rewardToken === null) return 'REWARD_POOL';
    return classicKind(reads) === 'BOOST' ? 'BOOST' : undefined;
};

export type Rejection = { chainId: number; address: string; expected: string; reason: string };
export type Verification = { kept: KnownContract[]; rejected: Rejection[] };

/** The addresses whose reads verification needs beyond the candidates: the on-chain strategies. */
export const strategiesToRead = (candidates: readonly Candidate[], reads: ReadonlyMap<string, Reads>) =>
    R.pipe(
        candidates,
        R.filter((candidate) => candidate.expected === 'VAULT' || candidate.expected === 'CLM_MANAGER'),
        R.map((candidate) => nonZero(reads.get(candidate.address)?.strategy)),
        R.filter((address): address is string => address !== undefined && !reads.has(address)),
        R.unique()
    );

/**
 * Keeps a candidate only when chain data confirms its kind:
 * - VAULT: classified as a vault (only `strategy()` answers) and its `strategy()` is a classic strategy whose
 *   `vault()` is the vault; that strategy is kept as STRATEGY, and so is the API's strategy when it also points back;
 * - CLM_MANAGER: `wants()` returns two tokens and its `strategy()` has `vault()` = the manager (kept as CLM_STRATEGY,
 *   as is the API's strategy when it points back);
 * - REWARD_POOL / BOOST (`/gov-vaults`, `/boosts`): the contract's shape decides (see `stakingKind`): the API lists
 *   reward-pool contracts under `/boosts` too, so a boost candidate can be kept as REWARD_POOL.
 */
export const verifyCandidates = (
    candidates: readonly Candidate[],
    reads: ReadonlyMap<string, Reads>,
    blacklisted: (chainId: number, address: string) => boolean
): Verification => {
    const verdicts = R.map(candidates, (candidate): { kept: KnownContract[]; reason?: string } => {
        const { chainId, address, expected } = candidate;
        if (blacklisted(chainId, address)) return { kept: [], reason: 'blacklisted' };
        const own = reads.get(address);
        if (!own) return { kept: [], reason: 'not read' };
        const keep = (kind: KnownKind, at: string): KnownContract => ({ chainId, address: at, kind });
        const strategies = (classic: boolean, kind: KnownKind) =>
            R.pipe(
                [nonZero(own.strategy), candidate.apiStrategy],
                R.filter((strategy): strategy is string => strategy !== undefined),
                R.unique(),
                R.filter(
                    (strategy) => pointsBack(reads.get(strategy), address, classic) && !blacklisted(chainId, strategy)
                ),
                R.map((strategy) => keep(kind, strategy))
            );
        switch (expected) {
            case 'VAULT': {
                const kind = classicKind(own);
                if (kind !== 'VAULT') return { kept: [], reason: `classified as ${kind}` };
                if (!pointsBack(reads.get(nonZero(own.strategy) ?? ''), address, true)) {
                    return { kept: [], reason: 'strategy() is not a strategy whose vault() is this vault' };
                }
                return { kept: [keep('VAULT', address), ...strategies(true, 'STRATEGY')] };
            }
            case 'CLM_MANAGER': {
                const [want0, want1] = own.wants ?? [];
                if (!nonZero(want0) || !nonZero(want1))
                    return { kept: [], reason: 'wants() did not return two tokens' };
                if (!pointsBack(reads.get(nonZero(own.strategy) ?? ''), address, false)) {
                    return { kept: [], reason: 'strategy() is not a strategy whose vault() is this manager' };
                }
                return { kept: [keep('CLM_MANAGER', address), ...strategies(false, 'CLM_STRATEGY')] };
            }
            case 'REWARD_POOL':
            case 'BOOST': {
                // The API files reward-pool contracts under /boosts (version 2) too: the shape decides the kind.
                const kind = stakingKind(own);
                if (!kind)
                    return {
                        kept: [],
                        reason: `neither a reward pool nor a boost (classified as ${classicKind(own)})`,
                    };
                return { kept: [keep(kind, address)] };
            }
        }
    });
    return {
        kept: R.pipe(
            verdicts,
            R.flatMap((verdict) => verdict.kept),
            R.uniqueBy((contract) => `${contract.chainId}-${contract.address}-${contract.kind}`)
        ),
        rejected: R.pipe(
            R.zip(candidates, verdicts),
            R.filter(([, verdict]) => verdict.reason !== undefined),
            R.map(([candidate, verdict]) => ({
                chainId: candidate.chainId,
                address: candidate.address,
                expected: candidate.expected,
                reason: verdict.reason as string,
            }))
        ),
    };
};

// ---------------------------------------------------------------------------------------------------------------------
// On-chain reads
// ---------------------------------------------------------------------------------------------------------------------

const detectionAbi = parseAbi([
    'function vault() view returns (address)',
    'function strategy() view returns (address)',
    'function rewardToken() view returns (address)',
    'function stakedToken() view returns (address)',
    'function wants() view returns (address, address)',
]);

type MulticallClient = {
    multicall: (args: {
        multicallAddress: Hex;
        allowFailure: true;
        batchSize: number;
        contracts: Array<{ address: Hex; abi: typeof detectionAbi; functionName: ReadFunction }>;
    }) => Promise<Array<{ status: 'success' | 'failure'; result?: unknown }>>;
};

const addressAnswer = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((value) => value.toLowerCase());
const addressPairAnswer = z
    .tuple([addressAnswer, addressAnswer])
    .rest(z.unknown())
    .transform(([a, b]) => [a, b] as const);

/** The detection calls on every address, at latest, in multicalls of CALLS_PER_MULTICALL calls. */
export const readDetection = async (client: MulticallClient, addresses: readonly string[]) => {
    const calls = R.pipe(
        addresses,
        R.flatMap((address) => R.map(READ_FUNCTIONS, (functionName) => ({ address, functionName })))
    );
    const chunks = R.chunk(calls, CALLS_PER_MULTICALL);
    const results: Array<{ status: 'success' | 'failure'; result?: unknown }> = [];
    for (const group of R.chunk(chunks, PARALLEL_MULTICALLS)) {
        const answers = await Promise.all(
            R.map(group, (chunk) =>
                client.multicall({
                    multicallAddress: MULTICALL3,
                    allowFailure: true,
                    batchSize: 0,
                    contracts: R.map(chunk, ({ address, functionName }) => ({
                        address: address as Hex,
                        abi: detectionAbi,
                        functionName,
                    })),
                })
            )
        );
        results.push(...answers.flat());
    }
    const answer = (index: number) => {
        const result = results[index];
        return result?.status === 'success' ? result.result : null;
    };
    // decoded by viem from the ABI, validated anyway: anything but an address (pair) counts as a failed call
    const asAddress = (value: unknown) => {
        const parsed = addressAnswer.safeParse(value);
        return parsed.success ? parsed.data : null;
    };
    const asAddressPair = (value: unknown) => {
        const parsed = addressPairAnswer.safeParse(value);
        return parsed.success ? parsed.data : null;
    };
    return new Map(
        R.map(addresses, (address, index): [string, Reads] => {
            const base = index * READ_FUNCTIONS.length;
            return [
                address,
                {
                    vault: asAddress(answer(base)),
                    strategy: asAddress(answer(base + 1)),
                    rewardToken: asAddress(answer(base + 2)),
                    stakedToken: asAddress(answer(base + 3)),
                    wants: asAddressPair(answer(base + 4)),
                },
            ];
        })
    );
};

/** Two rounds: candidates and the API strategies, then the on-chain strategies not read yet. */
export const verifyChain = async (
    client: MulticallClient,
    candidates: readonly Candidate[],
    blacklisted: (chainId: number, address: string) => boolean
): Promise<Verification> => {
    const first = R.pipe(
        candidates,
        R.flatMap((candidate) => [candidate.address, candidate.apiStrategy]),
        R.filter((address): address is string => address !== undefined),
        R.unique()
    );
    const reads = await readDetection(client, first);
    const second = await readDetection(client, strategiesToRead(candidates, reads));
    return verifyCandidates(candidates, new Map([...reads, ...second]), blacklisted);
};

// ---------------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------------

const summary = (contracts: readonly KnownContract[]) =>
    R.pipe(
        contracts,
        R.countBy((contract) => contract.kind)
    );

const command = new Command('known-contracts')
    .description(
        'Verifies the Beefy API products on chain and writes the confirmed ones into the generated blocks of config.yaml.'
    )
    .argument(
        '[chainIds...]',
        'chain ids (default: every chain in config.yaml)',
        (value: string, previous: number[] | undefined) => [...(previous ?? []), chainIdArg(value)]
    )
    .addHelpText(
        'after',
        `
Environment (scripts/lib/config.ts):
  ENVIO_RPC_URL_<chainId>   RPC of each chain (a chain without one keeps its current list)
  BEEFY_API_URL             Beefy API (default https://api.beefy.finance)`
    );

const main = async () => {
    const startedAt = Date.now();
    const selected = (command.parse().processedArgs[0] as number[] | undefined) ?? [];
    const config = scriptsConfig();
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const configYaml = readFileSync(join(root, configFileName()), 'utf8');
    const blacklist = new Set(
        R.map(
            loadVaultBlacklist(readFileSync(join(root, 'src/lib/blacklist.ts'), 'utf8')),
            ({ chainId, address }) => `${chainId}-${address}`
        )
    );
    const blacklisted = (chainId: number, address: string) => blacklist.has(`${chainId}-${address}`);
    const chainIds = selected.length > 0 ? R.unique(selected) : loadActiveChainIds(configYaml);
    const candidates = candidatesFromApi(await fetchBeefyApiLists(config.beefyApiUrl), chainIds);
    console.log(
        `Beefy API: ${candidates.length} candidates on ${chainIds.length} chains (${Date.now() - startedAt} ms)`
    );

    const known: KnownAddresses = extractKnownContracts(configYaml);
    const results = await Promise.all(
        R.map(chainIds, async (chainId) => {
            const chainCandidates = R.filter(candidates, (candidate) => candidate.chainId === chainId);
            const url = config.rpcUrls.get(chainId);
            if (!url) return { chainId, error: `ENVIO_RPC_URL_${chainId} is not set` };
            const client = createPublicClient({
                transport: http(url, { retryCount: 6, retryDelay: 1_000, timeout: 60_000 }),
            });
            try {
                return {
                    chainId,
                    candidates: chainCandidates.length,
                    ...(await verifyChain(client, chainCandidates, blacklisted)),
                };
            } catch (error) {
                return { chainId, error: describeError(error) };
            }
        })
    );

    for (const result of results) {
        if ('error' in result) {
            console.log(`chain ${result.chainId}: FAILED (${result.error}), keeping its current list`);
            continue;
        }
        const chainKnown = knownAddresses(result.kept).get(result.chainId) ?? new Map<string, string[]>();
        known.set(result.chainId, chainKnown);
        console.log(
            `chain ${result.chainId}: ${result.candidates} candidates, kept ${result.kept.length} ${JSON.stringify(summary(result.kept))}, rejected ${result.rejected.length}`
        );
        for (const rejection of result.rejected) {
            console.log(`  rejected ${rejection.address} (${rejection.expected}): ${rejection.reason}`);
        }
    }

    writeFileSync(join(root, configFileName()), mergeKnownContracts(configYaml, known));
    console.log(`wrote ${configFileName()} in ${Math.round((Date.now() - startedAt) / 1000)} s`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error: unknown) => {
        console.error(describeError(error));
        process.exit(1);
    });
}
