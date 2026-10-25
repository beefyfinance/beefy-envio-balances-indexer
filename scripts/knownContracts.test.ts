import * as R from 'remeda';
import { describe, expect, it } from 'vitest';
import { classifyClassicProxyReads } from '../src/lib/classify';
import {
    type Candidate,
    candidatesFromApi,
    READ_FUNCTIONS,
    type Reads,
    readDetection,
    strategiesToRead,
    verifyCandidates,
} from './knownContracts';

const address = (tag: number) => `0x${tag.toString(16).padStart(40, '0')}`;
const VAULT = address(1);
const STRATEGY = address(2);
const OLD_STRATEGY = address(3);
const MANAGER = address(4);
const CLM_STRATEGY = address(5);
const POOL = address(6);
const BOOST = address(7);
const TOKEN = address(8);
const OTHER = address(9);

const none: Reads = { vault: null, strategy: null, rewardToken: null, stakedToken: null, wants: null };
const reads = new Map<string, Reads>([
    [VAULT, { ...none, strategy: STRATEGY }],
    [STRATEGY, { ...none, vault: VAULT }],
    [OLD_STRATEGY, { ...none, vault: VAULT }],
    [MANAGER, { ...none, strategy: CLM_STRATEGY, wants: [TOKEN, OTHER] }],
    [CLM_STRATEGY, { ...none, vault: MANAGER }],
    [POOL, { ...none, stakedToken: TOKEN }],
    [BOOST, { ...none, rewardToken: TOKEN, stakedToken: TOKEN }],
]);
const notBlacklisted = () => false;

const kinds = (verification: ReturnType<typeof verifyCandidates>) =>
    R.pipe(
        verification.kept,
        R.map(({ address: at, kind }) => [at, kind]),
        R.sortBy(([at]) => at as string)
    );

describe('known contracts: Beefy API candidates', () => {
    it('maps the API lists to candidates on the requested chains, unique and sorted', () => {
        const candidates = candidatesFromApi(
            {
                vaults: [
                    { chain: 'base', earnContractAddress: VAULT.toUpperCase().replace('0X', '0x'), strategy: STRATEGY },
                    { chain: 'base', earnContractAddress: VAULT, strategy: STRATEGY },
                    { chain: 'fantom', earnContractAddress: OTHER },
                    { chain: 'base', earnContractAddress: null },
                ],
                cows: [{ chain: 'base', earnContractAddress: MANAGER, strategy: CLM_STRATEGY }],
                govs: [
                    { chain: 'base', earnContractAddress: POOL, version: 2 },
                    { chain: 'bsc', earnContractAddress: BOOST },
                ],
                boosts: [{ chain: 'base', earnContractAddress: BOOST, version: 2 }],
            },
            [8453, 56]
        );
        expect(candidates).toEqual([
            { chainId: 56, address: BOOST, expected: 'BOOST' },
            { chainId: 8453, address: VAULT, expected: 'VAULT', apiStrategy: STRATEGY },
            { chainId: 8453, address: MANAGER, expected: 'CLM_MANAGER', apiStrategy: CLM_STRATEGY },
            { chainId: 8453, address: POOL, expected: 'REWARD_POOL' },
            { chainId: 8453, address: BOOST, expected: 'BOOST' },
        ]);
    });
});

describe('known contracts: on-chain verification', () => {
    const candidate = (at: string, expected: Candidate['expected'], apiStrategy?: string): Candidate => ({
        chainId: 8453,
        address: at,
        expected,
        ...(apiStrategy ? { apiStrategy } : {}),
    });

    it('keeps products whose kind and links chain data confirms', () => {
        const verification = verifyCandidates(
            [
                candidate(VAULT, 'VAULT', OLD_STRATEGY),
                candidate(MANAGER, 'CLM_MANAGER', CLM_STRATEGY),
                candidate(POOL, 'REWARD_POOL'),
                candidate(BOOST, 'BOOST'),
                // the API lists reward-pool contracts under /boosts too: the contract shape decides
                candidate(POOL, 'BOOST'),
            ],
            reads,
            notBlacklisted
        );
        expect(kinds(verification)).toEqual([
            [VAULT, 'VAULT'],
            [STRATEGY, 'STRATEGY'],
            [OLD_STRATEGY, 'STRATEGY'],
            [MANAGER, 'CLM_MANAGER'],
            [CLM_STRATEGY, 'CLM_STRATEGY'],
            [POOL, 'REWARD_POOL'],
            [BOOST, 'BOOST'],
        ]);
        expect(verification.rejected).toEqual([]);
    });

    it('rejects candidates chain data contradicts, with a reason', () => {
        const broken = new Map<string, Reads>([
            ...reads,
            // strategy() answers but its strategy points elsewhere
            [OTHER, { ...none, strategy: STRATEGY }],
            // a manager without wants()
            [address(10), { ...none, strategy: CLM_STRATEGY }],
            // answers every detection call (fallback function)
            [address(11), { ...none, vault: TOKEN, strategy: TOKEN, rewardToken: TOKEN, stakedToken: TOKEN }],
        ]);
        const verification = verifyCandidates(
            [
                candidate(OTHER, 'VAULT'),
                candidate(address(10), 'CLM_MANAGER'),
                candidate(address(11), 'BOOST'),
                candidate(STRATEGY, 'VAULT'),
                candidate(address(12), 'REWARD_POOL'),
                candidate(VAULT, 'VAULT'),
            ],
            broken,
            (_, at) => at === VAULT
        );
        expect(verification.kept).toEqual([]);
        expect(R.map(verification.rejected, ({ address: at, reason }) => [at, reason])).toEqual([
            [OTHER, 'strategy() is not a strategy whose vault() is this vault'],
            [address(10), 'wants() did not return two tokens'],
            [address(11), 'neither a reward pool nor a boost (classified as UNKNOWN)'],
            [STRATEGY, 'classified as STRATEGY'],
            [address(12), 'not read'],
            [VAULT, 'blacklisted'],
        ]);
    });

    it('uses the classification of the factory handlers (src/lib/classify.ts) for vaults and boosts', () => {
        const answers = [true, false];
        for (const vault of answers) {
            for (const strategy of answers) {
                for (const rewardToken of answers) {
                    const own: Reads = {
                        vault: vault ? OTHER : null,
                        strategy: strategy ? STRATEGY : null,
                        rewardToken: rewardToken ? TOKEN : null,
                        stakedToken: TOKEN,
                        wants: null,
                    };
                    const handlers = classifyClassicProxyReads({ vault, strategy, rewardToken });
                    const verification = verifyCandidates(
                        [candidate(VAULT, 'VAULT'), candidate(VAULT, 'BOOST')],
                        new Map([...reads, [VAULT, own]]),
                        notBlacklisted
                    );
                    const keptKinds = R.map(
                        R.filter(verification.kept, (kept) => kept.address === VAULT),
                        (kept) => kept.kind
                    );
                    if (handlers === 'VAULT') expect(keptKinds).toEqual(['VAULT']);
                    if (handlers === 'BOOST') expect(keptKinds).toEqual(['BOOST']);
                    if (handlers === 'STRATEGY' || handlers === 'UNKNOWN') {
                        // only a reward-pool shape (no detection call answers) can still be kept
                        expect(keptKinds).toEqual(!vault && !strategy && !rewardToken ? ['REWARD_POOL'] : []);
                    }
                }
            }
        }
    });

    it('reads the on-chain strategies the candidates point to in a second round', () => {
        const firstRound = new Map([...reads].filter(([at]) => at !== STRATEGY && at !== CLM_STRATEGY));
        expect(
            strategiesToRead(
                [candidate(VAULT, 'VAULT'), candidate(MANAGER, 'CLM_MANAGER'), candidate(POOL, 'REWARD_POOL')],
                firstRound
            )
        ).toEqual([STRATEGY, CLM_STRATEGY]);
    });

    it('batches every detection call into multicalls and maps failures to null', async () => {
        const multicalls: number[] = [];
        const client = {
            multicall: async ({ contracts }: { contracts: Array<{ address: string; functionName: string }> }) => {
                multicalls.push(contracts.length);
                return R.map(contracts, ({ address: at, functionName }) => {
                    const value = reads.get(at)?.[functionName as (typeof READ_FUNCTIONS)[number]];
                    return value === null || value === undefined
                        ? { status: 'failure' as const }
                        : { status: 'success' as const, result: value };
                });
            },
        };
        const result = await readDetection(client as never, [VAULT, MANAGER, POOL]);
        expect(multicalls).toEqual([3 * READ_FUNCTIONS.length]);
        expect(result.get(VAULT)).toEqual(reads.get(VAULT));
        expect(result.get(MANAGER)).toEqual(reads.get(MANAGER));
        expect(result.get(POOL)).toEqual(reads.get(POOL));
    });
});
