/**
 * Correctness checker: compares what the raw-events indexer stored in Postgres with the chain, at a fixed block
 * (docs/architecture.md for the entity meanings and the balances rules).
 *
 * Checks (each prints PASS / FAIL with counts and the first mismatches; exit code 1 when any check fails):
 *
 * 1. supply: every `TokenSupply` row equals `totalSupply()` at the block (boosts: the boost's `totalSupply()`), share
 *    tokens without a row have a zero supply, and the `Balance` rows of each token sum to its `TokenSupply`.
 * 2. balances: every `Balance` row equals `balanceOf(account)` at the block (its value at the block when it changed
 *    later), plus the internal consistency of `Balance` / `BalanceChange` (running sums, no 0x0 rows).
 * 3. events: `Transfer` logs of share tokens, boost `Staked` / `Withdrawn` and CLM `Deposit` / `Withdraw` fetched with
 *    `eth_getLogs` from the chain's start_block, compared with `ShareTransfer`, `BoostStake`, `ClmDeposit` and
 *    `ClmWithdraw` by (trxHash, logIndex), per-emitter counts and decoded fields.
 * 4. fields: a sample of event rows across the event tables: the log at `log_index` exists in the transaction
 *    receipt, its emitter and topic0 fit the table, and block number, block timestamp, trxHash and trxFrom match.
 * 5. clm-pool-state: every CLM `TVL` / `Harvest` block has a `ClmPoolState` row, and a sample of rows equals
 *    `price()`, `range()`, `balancesOfPool()` re-read at the row's block.
 * 6. coverage: row counts, contracts per kind, static config addresses without a `Contract` row (FAIL when the
 *    address emitted a handled event before the block), kind mismatches, PARTIAL facts, token metadata problems.
 *
 * The block defaults to the chain's `progress_block` in Envio's `envio_chains` table (the last block whose events are
 * all processed and stored), so a run during indexing only compares fully indexed data.
 *
 * Usage: pnpm correctness --chain 4326 [--block N] [--schema raw_megaeth] [--rpc URL] [--only supply,balances,...]
 *        [--sample 100] [--concurrency 3] [--config config.local.yaml]
 * RPC defaults to ENVIO_RPC_URL_<chain>; Postgres comes from ENVIO_PG_HOST / PORT / USER / PASSWORD / DATABASE
 * (defaults: localhost, 5433, postgres, testing, envio-dev) and is read with `psql` (override the binary with PSQL).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from 'remeda';
import {
    type Abi,
    createPublicClient,
    decodeEventLog,
    decodeFunctionResult,
    encodeFunctionData,
    type Hex,
    http,
    numberToHex,
    type PublicClient,
    parseAbi,
    toEventSelector,
    toEventSignature,
} from 'viem';

// ---------------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------------

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const CALLS_PER_MULTICALL = 200;
const LOG_RANGE = 100_000n;
const ADDRESSES_PER_LOG_QUERY = 500;
const MAX_SHOWN = 10;

export const CHECK_NAMES = ['supply', 'balances', 'events', 'fields', 'clm-pool-state', 'coverage'] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

/** Contract kinds whose address is a share token (src/lib/registry.ts). */
const SHARE_KINDS = new Set(['VAULT', 'BOOST', 'REWARD_POOL', 'CLM_MANAGER', 'ERC4626_ADAPTER', 'LST_VAULT', 'TOKEN']);

/** Expected `Contract.kind` of each config contract name (factories get no Contract row). */
const CONFIG_KIND: Record<string, string> = {
    ClassicVault: 'VAULT',
    ClassicStrategy: 'STRATEGY',
    ClassicStrategyStratHarvest0: 'STRATEGY',
    ClassicStrategyStratHarvest1: 'STRATEGY',
    ClassicBoost: 'BOOST',
    RewardPool: 'REWARD_POOL',
    ClmManager: 'CLM_MANAGER',
    ClmStrategy: 'CLM_STRATEGY',
    LstVault: 'LST_VAULT',
    Erc4626Adapter: 'ERC4626_ADAPTER',
    Token: 'TOKEN',
    BeefySwapper: 'SWAPPER',
};

const topic = (signature: string) => toEventSelector(signature).toLowerCase();

export const TOPICS = {
    transfer: topic('Transfer(address,address,uint256)'),
    staked: topic('Staked(address,uint256)'),
    withdrawn: topic('Withdrawn(address,uint256)'),
    clmDeposit: topic('Deposit(address,uint256,uint256,uint256,uint256,uint256)'),
    clmWithdraw: topic('Withdraw(address,uint256,uint256,uint256)'),
};

const eventAbi = parseAbi([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Staked(address indexed user, uint256 amount)',
    'event Withdrawn(address indexed user, uint256 amount)',
    'event Deposit(address indexed user, uint256 shares, uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1)',
    'event Withdraw(address indexed user, uint256 shares, uint256 amount0, uint256 amount1)',
]);

const erc20Abi = parseAbi([
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
]);

/** Reads that tell whether a contract the indexer marked incomplete is itself empty (never initialized) on chain. */
const factsAbi = parseAbi([
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function want() view returns (address)',
    'function strategy() view returns (address)',
    'function vault() view returns (address)',
    'function wants() view returns (address, address)',
    'function stakedToken() view returns (address)',
]);
const FACT_READS: Record<string, string[]> = {
    VAULT: ['want', 'strategy'],
    STRATEGY: ['vault'],
    CLM_STRATEGY: ['vault'],
    CLM_MANAGER: ['wants'],
    REWARD_POOL: ['stakedToken'],
    BOOST: ['stakedToken'],
    ERC4626_ADAPTER: ['vault'],
};

/** A read answers something the indexer should have recorded: a non-empty string or a non-zero address. */
export const hasOnChainValue = (read: CallResult) => {
    if (!read.ok) return false;
    const values: unknown[] = Array.isArray(read.value) ? read.value : [read.value];
    return values.some((value) => typeof value === 'string' && value !== '' && value.toLowerCase() !== ZERO_ADDRESS);
};

const clmStrategyAbi = parseAbi([
    'function price() view returns (uint256)',
    'function range() view returns (uint256 lowerPrice, uint256 upperPrice)',
    'function balancesOfPool() view returns (uint256 token0Bal, uint256 token1Bal, uint256 mainAmount0, uint256 mainAmount1, uint256 altAmount0, uint256 altAmount1)',
]);

const multicall3Abi = parseAbi([
    'struct Call3 { address target; bool allowFailure; bytes callData; }',
    'struct Result { bool success; bytes returnData; }',
    'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
]);

/** Event tables: the column holding the emitting contract and the events the table is written from. */
export const EVENT_TABLES: Record<string, { emitter: string; topics: string[]; idSuffix?: boolean }> = {
    ShareTransfer: { emitter: 'token', topics: [TOPICS.transfer] },
    BalanceChange: { emitter: 'token', topics: [TOPICS.transfer, TOPICS.staked, TOPICS.withdrawn], idSuffix: true },
    BoostStake: { emitter: 'boost', topics: [TOPICS.staked, TOPICS.withdrawn] },
    ClmDeposit: { emitter: 'manager', topics: [TOPICS.clmDeposit] },
    ClmWithdraw: { emitter: 'manager', topics: [TOPICS.clmWithdraw] },
    ClmTvl: { emitter: 'strategy', topics: [topic('TVL(uint256,uint256)')] },
    Harvest: {
        emitter: 'strategy',
        topics: R.map(
            [
                'StratHarvest(address,uint256,uint256)',
                'Harvest(uint256,uint256)',
                'HarvestRewards(uint256)',
                'ClaimedFees(uint256,uint256,uint256,uint256)',
                'ClaimedRewards(uint256)',
            ],
            topic
        ),
    },
    FeesCharged: {
        emitter: 'strategy',
        topics: R.map(['ChargedFees(uint256,uint256)', 'ChargedFees(uint256,uint256,uint256)'], topic),
    },
    PauseChange: { emitter: 'contract', topics: R.map(['Paused(address)', 'Unpaused(address)'], topic) },
    RewardNotified: {
        emitter: 'contract',
        topics: R.map(['RewardAdded(uint256)', 'NotifyReward(address,uint256,uint256)'], topic),
    },
    RewardPaid: {
        emitter: 'contract',
        topics: R.map(['RewardPaid(address,uint256)', 'RewardPaid(address,address,uint256)'], topic),
    },
    SwapperRouteChange: {
        emitter: 'swapper',
        topics: [topic('SetSwapInfo(address,address,(address,bytes,uint256,uint256,int8))')],
    },
    SwapperConfigChange: {
        emitter: 'swapper',
        topics: R.map(['Initialized(uint8)', 'SetOracle(address)', 'SetSlippage(uint256)'], topic),
    },
};

const ENTITY_TABLES = [
    'Contract',
    'Token',
    'ContractLink',
    'ShareTransfer',
    'BalanceChange',
    'Balance',
    'TokenSupply',
    'BoostStake',
    'ClmDeposit',
    'ClmWithdraw',
    'ClmTvl',
    'ClmPoolState',
    'RewardNotified',
    'RewardPaid',
    'Harvest',
    'FeesCharged',
    'PauseChange',
    'SwapperRoute',
    'SwapperRouteChange',
    'SwapperConfigChange',
] as const;

// ---------------------------------------------------------------------------------------------------------------------
// Pure helpers (unit tested in scripts/correctness.test.ts)
// ---------------------------------------------------------------------------------------------------------------------

export type Args = {
    chainId: number;
    block: bigint | undefined;
    schema: string;
    rpc: string;
    only: CheckName[];
    sample: number;
    concurrency: number;
    config: string;
};

/** CLI arguments; `env` supplies the RPC default (ENVIO_RPC_URL_<chain>) and the schema default (ENVIO_PG_SCHEMA). */
export const parseArgs = (argv: readonly string[], env: Record<string, string | undefined>): Args => {
    const flags = new Map<string, string>();
    for (let index = 0; index < argv.length; index++) {
        const flag = argv[index] as string;
        if (!flag.startsWith('--')) throw new Error(`unexpected argument: ${flag}`);
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
        flags.set(flag.slice(2), value);
        index++;
    }
    const known = new Set(['chain', 'block', 'schema', 'rpc', 'only', 'sample', 'concurrency', 'config']);
    const unknown = R.filter([...flags.keys()], (flag) => !known.has(flag));
    if (unknown.length > 0) throw new Error(`unknown flag(s): ${R.map(unknown, (flag) => `--${flag}`).join(', ')}`);

    const chain = flags.get('chain');
    if (chain === undefined || !/^\d+$/.test(chain)) throw new Error('--chain <chainId> is required');
    const chainId = Number(chain);
    const block = flags.get('block');
    if (block !== undefined && !/^\d+$/.test(block)) throw new Error(`invalid --block: ${block}`);
    const schema = flags.get('schema') ?? env.ENVIO_PG_SCHEMA ?? 'public';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error(`invalid --schema: ${schema}`);
    const rpc = flags.get('rpc') ?? env[`ENVIO_RPC_URL_${chainId}`];
    if (!rpc) throw new Error(`no RPC: pass --rpc or set ENVIO_RPC_URL_${chainId}`);
    const only = R.pipe(
        flags.get('only')?.split(',') ?? [...CHECK_NAMES],
        R.map((name) => name.trim()),
        R.filter((name) => name !== '')
    );
    const invalid = R.filter(only, (name) => !(CHECK_NAMES as readonly string[]).includes(name));
    if (invalid.length > 0)
        throw new Error(`unknown check(s): ${invalid.join(', ')} (known: ${CHECK_NAMES.join(', ')})`);
    const positive = (name: string, fallback: number) => {
        const value = Number(flags.get(name) ?? fallback);
        if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid --${name}`);
        return value;
    };
    return {
        chainId,
        block: block === undefined ? undefined : BigInt(block),
        schema,
        rpc,
        only: only as CheckName[],
        sample: positive('sample', 100),
        concurrency: positive('concurrency', 3),
        config: flags.get('config') ?? 'config.local.yaml',
    };
};

export type Row = Record<string, string | null>;

/** Parses `psql --csv` output (RFC 4180, header row). An unquoted empty field is NULL, `""` is an empty string. */
export const parseCsv = (text: string): Row[] => {
    const records: (string | null)[][] = [];
    let record: (string | null)[] = [];
    let field = '';
    let quoted = false;
    let inQuotes = false;
    const endField = () => {
        record.push(quoted || field !== '' ? field : null);
        field = '';
        quoted = false;
    };
    let index = 0;
    while (index < text.length) {
        const char = text[index] as string;
        if (inQuotes) {
            if (char === '"' && text[index + 1] === '"') {
                field += '"';
                index += 2;
            } else if (char === '"') {
                inQuotes = false;
                index++;
            } else {
                field += char;
                index++;
            }
        } else if (char === '"') {
            inQuotes = true;
            quoted = true;
            index++;
        } else if (char === ',') {
            endField();
            index++;
        } else if (char === '\n' || char === '\r') {
            endField();
            records.push(record);
            record = [];
            index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
        } else {
            field += char;
            index++;
        }
    }
    if (field !== '' || quoted || record.length > 0) {
        endField();
        records.push(record);
    }
    const [header, ...rows] = records;
    if (header === undefined) return [];
    return R.map(rows, (values) =>
        R.pipe(
            header,
            R.map((name, column) => [name ?? '', values[column] ?? null] as [string, string | null]),
            R.fromEntries()
        )
    );
};

export type ChainConfig = {
    startBlock: bigint;
    /** static addresses (lowercase) per config contract name, factories included */
    contracts: { name: string; address: string }[];
};

/** The `chains[]` entry of a config.yaml (line based, the generated layout of configVariants.ts). */
export const parseChainConfig = (configYaml: string, chainId: number): ChainConfig | undefined => {
    let current: number | undefined;
    let contract: string | undefined;
    let startBlock: bigint | undefined;
    const contracts: { name: string; address: string }[] = [];
    for (const line of configYaml.split('\n')) {
        const chainMatch = line.match(/^ {2}- id: (\d+)\b/);
        if (chainMatch) {
            current = Number(chainMatch[1]);
            contract = undefined;
            continue;
        }
        if (/^\S/.test(line)) current = undefined; // a new top-level key ends `chains:`
        if (current !== chainId) continue;
        const start = line.match(/^ {4}start_block: (\d+)/);
        if (start) startBlock = BigInt(start[1] as string);
        const name = line.match(/^ {6}- name: (\w+)\s*$/);
        if (name) contract = name[1];
        const address =
            line.match(/^ {8}address: (0x[0-9a-fA-F]{40})\b/) ?? line.match(/^ {10}- (0x[0-9a-fA-F]{40})\b/);
        if (address && contract !== undefined) {
            contracts.push({ name: contract, address: (address[1] as string).toLowerCase() });
        }
    }
    return startBlock === undefined ? undefined : { startBlock, contracts };
};

/** topic0 of every event handled in the config (`- event: "..."` lines). */
export const handledEventTopics = (configYaml: string): string[] =>
    R.pipe(
        configYaml.split('\n'),
        R.map((line) => line.match(/^\s*- event: "(.+)"\s*$/)?.[1]),
        R.filter((signature) => signature !== undefined),
        R.map((signature) => topic(toEventSignature(signature))),
        R.unique()
    );

/** Inclusive block ranges of at most `size` blocks covering [from, to]. */
export const blockRanges = (from: bigint, to: bigint, size: bigint): { from: bigint; to: bigint }[] => {
    const ranges: { from: bigint; to: bigint }[] = [];
    for (let start = from; start <= to; start += size) {
        ranges.push({ from: start, to: start + size - 1n < to ? start + size - 1n : to });
    }
    return ranges;
};

export const eventKey = (trxHash: string, logIndex: number | string) => `${trxHash.toLowerCase()}-${Number(logIndex)}`;

/** Keys only on chain (missing in the DB), only in the DB (extra), and in both. */
export const diffKeys = (chain: ReadonlySet<string>, db: ReadonlySet<string>) => ({
    missing: R.filter([...chain], (key) => !db.has(key)).sort(),
    extra: R.filter([...db], (key) => !chain.has(key)).sort(),
    matched: R.filter([...chain], (key) => db.has(key)).sort(),
});

const normalize = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'bigint' || typeof value === 'number') return value.toString();
    return String(value).toLowerCase();
};

/** `field: expected != actual` for each differing field of `expected` (bigints, numbers and hex compared as text). */
export const fieldMismatches = (expected: Record<string, unknown>, actual: Record<string, unknown>): string[] =>
    R.pipe(
        R.entries(expected),
        R.filter(([field, value]) => normalize(value) !== normalize(actual[field])),
        R.map(([field, value]) => `${field}: chain ${normalize(value)} != db ${normalize(actual[field])}`)
    );

/** Per-emitter counts that differ between chain and DB. */
export const countMismatches = (chain: readonly string[], db: readonly string[]): string[] => {
    const chainCounts = R.countBy(chain, R.identity());
    const dbCounts = R.countBy(db, R.identity());
    return R.pipe(
        R.unique([...chain, ...db]),
        R.sort((a, b) => a.localeCompare(b)),
        R.filter((emitter) => (chainCounts[emitter] ?? 0) !== (dbCounts[emitter] ?? 0)),
        R.map((emitter) => `${emitter}: chain ${chainCounts[emitter] ?? 0} != db ${dbCounts[emitter] ?? 0}`)
    );
};

export type ChainLog = {
    address: string;
    topics: readonly string[];
    data: string;
    blockNumber: bigint;
    transactionHash: string;
    logIndex: number;
};

export type EventCategory = 'ShareTransfer' | 'BoostStake' | 'ClmDeposit' | 'ClmWithdraw';

/** The indexer table a log should land in, given the emitter sets (only ERC-20 transfers: 3 topics). */
export const classifyLog = (
    log: Pick<ChainLog, 'address' | 'topics'>,
    sets: { transferTokens: ReadonlySet<string>; boosts: ReadonlySet<string>; managers: ReadonlySet<string> }
): EventCategory | undefined => {
    const address = log.address.toLowerCase();
    const topic0 = log.topics[0]?.toLowerCase();
    if (topic0 === TOPICS.transfer && log.topics.length === 3 && sets.transferTokens.has(address)) {
        return 'ShareTransfer';
    }
    if ((topic0 === TOPICS.staked || topic0 === TOPICS.withdrawn) && sets.boosts.has(address)) return 'BoostStake';
    if (topic0 === TOPICS.clmDeposit && sets.managers.has(address)) return 'ClmDeposit';
    if (topic0 === TOPICS.clmWithdraw && sets.managers.has(address)) return 'ClmWithdraw';
    return undefined;
};

/** The row fields a log should produce (compared with the stored row). */
export const expectedRowFields = (category: EventCategory, log: ChainLog): Record<string, unknown> => {
    const decoded = decodeEventLog({
        abi: eventAbi,
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
    });
    const base = { emitter: log.address, block_number: log.blockNumber };
    const args = decoded.args as Record<string, unknown>;
    switch (category) {
        case 'ShareTransfer':
            return { ...base, from_address: args.from, to_address: args.to, value: args.value };
        case 'BoostStake':
            return {
                ...base,
                user: args.user,
                amount: args.amount,
                direction: decoded.eventName === 'Staked' ? 'STAKE' : 'UNSTAKE',
            };
        case 'ClmDeposit':
            return {
                ...base,
                user: args.user,
                shares: args.shares,
                amount0: args.amount0,
                amount1: args.amount1,
                fee0: args.fee0,
                fee1: args.fee1,
            };
        case 'ClmWithdraw':
            return { ...base, user: args.user, shares: args.shares, amount0: args.amount0, amount1: args.amount1 };
    }
};

/** Even split of the sample size over the tables that have rows. */
export const sampleSizes = (counts: Record<string, number>, total: number): Record<string, number> => {
    const nonEmpty = R.filter(R.entries(counts), ([, count]) => count > 0);
    const each = nonEmpty.length === 0 ? 0 : Math.ceil(total / nonEmpty.length);
    return R.pipe(
        nonEmpty,
        R.map(([table, count]) => [table, Math.min(count, each)] as [string, number]),
        R.fromEntries()
    );
};

export type CheckStatus = 'PASS' | 'FAIL';
export type CheckResult = { name: string; status: CheckStatus; details: string[]; mismatches: string[] };

export const result = (name: string, details: string[], mismatches: string[]): CheckResult => ({
    name,
    status: mismatches.length === 0 ? 'PASS' : 'FAIL',
    details,
    mismatches,
});

export const formatResult = (check: CheckResult): string =>
    [
        `[${check.status}] ${check.name}`,
        ...R.map(check.details, (detail) => `    ${detail}`),
        ...(check.mismatches.length > 0 ? [`    ${check.mismatches.length} mismatch(es):`] : []),
        ...R.map(R.take(check.mismatches, MAX_SHOWN), (mismatch) => `      - ${mismatch}`),
        ...(check.mismatches.length > MAX_SHOWN ? [`      ... ${check.mismatches.length - MAX_SHOWN} more`] : []),
    ].join('\n');

const big = (value: string | null | undefined): bigint | undefined =>
    value === null || value === undefined || value === '' ? undefined : BigInt(value);

// ---------------------------------------------------------------------------------------------------------------------
// I/O: Postgres (psql) and RPC
// ---------------------------------------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorText = (error: unknown) =>
    error instanceof Error ? `${error.message} ${'details' in error ? String(error.details) : ''}` : String(error);

const isRateLimited = (error: unknown) =>
    /rate limit|429|too many requests|-32005|exceeded the quota/i.test(errorText(error));

const isTooLarge = (error: unknown) =>
    /more than|too many|too large|limit|range|timeout|timed out|took too long|response size|exceed/i.test(
        errorText(error)
    );

/** Retries rate limits (exponential backoff, up to ~2 minutes) and other errors twice. */
const withRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const limited = isRateLimited(error);
            if (attempt >= (limited ? 8 : 2)) throw error;
            await sleep(Math.min(30_000, 1_000 * 2 ** attempt) + Math.random() * 500);
        }
    }
};

/** Runs `fn` over `items` with at most `limit` concurrent calls; results keep the input order. */
const mapLimit = async <T, U>(items: readonly T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> => {
    const out: U[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            out[index] = await fn(items[index] as T);
        }
    };
    await Promise.all(R.times(Math.min(limit, items.length), worker));
    return out;
};

type Db = { query: (sql: string) => Promise<Row[]>; table: (name: string) => string; chainId: number };

const createDb = (env: Record<string, string | undefined>, schema: string, chainId: number): Db => {
    const pg = {
        host: env.ENVIO_PG_HOST ?? 'localhost',
        port: env.ENVIO_PG_PORT ?? '5433',
        user: env.ENVIO_PG_USER ?? 'postgres',
        password: env.ENVIO_PG_PASSWORD ?? 'testing',
        database: env.ENVIO_PG_DATABASE ?? 'envio-dev',
    };
    const query = (sql: string) =>
        new Promise<Row[]>((resolve, reject) => {
            const child = spawn(
                env.PSQL ?? 'psql',
                [
                    '-X',
                    '-q',
                    '--csv',
                    '-v',
                    'ON_ERROR_STOP=1',
                    '-h',
                    pg.host,
                    '-p',
                    pg.port,
                    '-U',
                    pg.user,
                    '-d',
                    pg.database,
                    '-c',
                    sql,
                ],
                { env: { ...process.env, PGPASSWORD: pg.password } }
            );
            const stdout: Buffer[] = [];
            const stderr: Buffer[] = [];
            child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
            child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
            child.on('error', reject);
            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`psql failed (${code}): ${Buffer.concat(stderr).toString()}\n${sql}`));
                } else {
                    resolve(parseCsv(Buffer.concat(stdout).toString()));
                }
            });
        });
    return { query, table: (name) => `"${schema}"."${name}"`, chainId };
};

type Call = { address: string; abi: Abi; functionName: string; args?: readonly unknown[] };
type CallResult = { ok: true; value: unknown } | { ok: false };

type Rpc = {
    client: PublicClient;
    /** aggregate3 multicalls of CALLS_PER_MULTICALL calls pinned at `block`, `concurrency` at a time */
    read: (calls: readonly Call[], block: bigint) => Promise<CallResult[]>;
    getLogs: (addresses: readonly string[], topics: readonly string[], from: bigint, to: bigint) => Promise<ChainLog[]>;
};

const createRpc = (url: string, concurrency: number): Rpc => {
    const client = createPublicClient({ transport: http(url, { retryCount: 0, timeout: 60_000 }) }) as PublicClient;

    const readChunk = async (calls: readonly Call[], block: bigint): Promise<CallResult[]> => {
        const data = encodeFunctionData({
            abi: multicall3Abi,
            functionName: 'aggregate3',
            args: [
                R.map(calls, (call) => ({
                    target: call.address as Hex,
                    allowFailure: true,
                    callData: encodeFunctionData({
                        abi: call.abi,
                        functionName: call.functionName,
                        args: call.args ?? [],
                    } as Parameters<typeof encodeFunctionData>[0]),
                })),
            ],
        });
        const response = await withRetry(() => client.call({ to: MULTICALL3, data, blockNumber: block }));
        const results = decodeFunctionResult({
            abi: multicall3Abi,
            functionName: 'aggregate3',
            data: response.data ?? '0x',
        });
        return R.map(results, ({ success, returnData }, index): CallResult => {
            const call = calls[index] as Call;
            if (!success || returnData === '0x') return { ok: false };
            try {
                const value = decodeFunctionResult({
                    abi: call.abi,
                    functionName: call.functionName,
                    data: returnData,
                } as Parameters<typeof decodeFunctionResult>[0]);
                return { ok: true, value };
            } catch {
                return { ok: false };
            }
        });
    };

    const read = async (calls: readonly Call[], block: bigint) =>
        (await mapLimit(R.chunk(calls, CALLS_PER_MULTICALL), concurrency, (chunk) => readChunk(chunk, block))).flat();

    /** eth_getLogs over [from, to]; a range the node refuses (too many results) is split in halves. */
    const getLogs = async (
        addresses: readonly string[],
        topics: readonly string[],
        from: bigint,
        to: bigint
    ): Promise<ChainLog[]> => {
        try {
            const logs = await withRetry(() =>
                client.request({
                    method: 'eth_getLogs',
                    params: [
                        {
                            address: addresses as Hex[],
                            topics: topics.length > 0 ? [topics as Hex[]] : [],
                            fromBlock: numberToHex(from),
                            toBlock: numberToHex(to),
                        },
                    ],
                })
            );
            return R.pipe(
                logs,
                R.filter((log) => !log.removed),
                R.map((log) => ({
                    address: log.address.toLowerCase(),
                    topics: R.map(log.topics, (value) => value.toLowerCase()),
                    data: log.data,
                    blockNumber: BigInt(log.blockNumber ?? '0x0'),
                    transactionHash: (log.transactionHash ?? '').toLowerCase(),
                    logIndex: Number(log.logIndex ?? '0x0'),
                }))
            );
        } catch (error) {
            // only a too-large answer is worth splitting; anything else would bisect down to single blocks
            if (to <= from || isRateLimited(error) || !isTooLarge(error)) throw error;
            const middle = (from + to) / 2n;
            return [
                ...(await getLogs(addresses, topics, from, middle)),
                ...(await getLogs(addresses, topics, middle + 1n, to)),
            ];
        }
    };

    return { client, read, getLogs };
};

/** Logs of `addresses` with any of `topics` over [from, to] (100k-block ranges, address chunks, modest concurrency). */
const fetchLogs = async (
    ctx: Ctx,
    addresses: readonly string[],
    topics: readonly string[],
    from: bigint,
    to: bigint,
    label: string
): Promise<ChainLog[]> => {
    const jobs = R.pipe(
        blockRanges(from, to, LOG_RANGE),
        R.flatMap((range) =>
            R.map(R.chunk(addresses, ADDRESSES_PER_LOG_QUERY), (chunk) => ({ ...range, addresses: chunk }))
        )
    );
    let done = 0;
    const results = await mapLimit(jobs, ctx.args.concurrency, async (job) => {
        const logs = await ctx.rpc.getLogs(job.addresses, topics, job.from, job.to);
        done++;
        if (done % 25 === 0 || done === jobs.length)
            process.stderr.write(`  ${label}: ${done}/${jobs.length} log queries\n`);
        return logs;
    });
    return results.flat();
};

// ---------------------------------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------------------------------

type ContractRow = { address: string; kind: string; factsStatus: string | null; createdBlock: bigint | undefined };
type TokenRow = {
    address: string;
    decimals: string | null;
    symbol: string | null;
    name: string | null;
    metadataStatus: string | null;
    isBeefyShare: boolean;
};

type Ctx = {
    args: Args;
    db: Db;
    rpc: Rpc;
    block: bigint;
    chain: ChainConfig;
    configYaml: string;
    contracts: ContractRow[];
    tokens: TokenRow[];
    /** Contract.kind per address */
    kindOf: Map<string, string>;
    /** kind per share token (Contract.kind, else the config listing) */
    shareKindOf: Map<string, string>;
    /** share token addresses: share-kind contracts, `Token.isBeefyShare` rows and static share contracts of the config */
    shareTokens: string[];
};

const chainFilter = (ctx: Ctx) => `chain_id = ${ctx.db.chainId}`;

const checkSupply = async (ctx: Ctx): Promise<CheckResult[]> => {
    const { db, block } = ctx;
    const rows = await db.query(
        `select token, total_supply, last_change_block from ${db.table('TokenSupply')} where ${chainFilter(ctx)}`
    );
    const share = new Set(ctx.shareTokens);
    const notShare = R.filter(rows, (row) => !share.has(row.token as string));
    const changedLater = R.filter(rows, (row) => (big(row.last_change_block) ?? 0n) > block);
    const toCheck = R.filter(rows, (row) => (big(row.last_change_block) ?? 0n) <= block);
    const withRow = new Set(R.map(rows, (row) => row.token as string));
    const withoutRow = R.filter(ctx.shareTokens, (token) => !withRow.has(token));

    const calls = R.map([...R.map(toCheck, (row) => row.token as string), ...withoutRow], (token) => ({
        address: token,
        abi: erc20Abi,
        functionName: 'totalSupply',
    }));
    const reads = await ctx.rpc.read(calls, block);
    const mismatches = [
        ...R.map(notShare, (row) => `${row.token}: TokenSupply row for a token that is not a Beefy share`),
        ...R.pipe(
            toCheck,
            R.map((row, index) => {
                const read = reads[index];
                const kind = ctx.shareKindOf.get(row.token as string) ?? 'not a share';
                if (!read?.ok) return `${row.token} (${kind}): totalSupply() reverted, db ${row.total_supply}`;
                return (read.value as bigint) === big(row.total_supply)
                    ? undefined
                    : `${row.token} (${kind}): chain ${read.value} != db ${row.total_supply}`;
            }),
            R.filter((line) => line !== undefined)
        ),
        ...R.pipe(
            withoutRow,
            R.map((token, index) => {
                const read = reads[toCheck.length + index];
                return read?.ok && (read.value as bigint) !== 0n
                    ? `${token} (${ctx.shareKindOf.get(token)}): no TokenSupply row, chain totalSupply ${read.value}`
                    : undefined;
            }),
            R.filter((line) => line !== undefined)
        ),
    ];

    // internal: Balance rows sum to TokenSupply (current state, independent of --block)
    const sums = await db.query(
        `with s as (select token, sum(balance) as total, count(*) as holders from ${db.table('Balance')} where ${chainFilter(ctx)} group by token),
              t as (select token, total_supply from ${db.table('TokenSupply')} where ${chainFilter(ctx)})
         select coalesce(s.token, t.token) as token, s.total, s.holders, t.total_supply
         from s full outer join t on s.token = t.token`
    );
    const sumMismatches = R.pipe(
        sums,
        R.filter((row) => (big(row.total) ?? 0n) !== (big(row.total_supply) ?? 0n)),
        R.map(
            (row) =>
                `${row.token}: sum(Balance) ${row.total ?? 'none'} (${row.holders ?? 0} rows) != TokenSupply ${row.total_supply ?? 'none'}`
        )
    );
    return [
        result(
            'supply: TokenSupply vs totalSupply()',
            [
                `${toCheck.length} TokenSupply rows checked at block ${block}, ${withoutRow.length} share tokens without a row checked for zero supply`,
                `${changedLater.length} rows skipped (changed after the block)`,
            ],
            mismatches
        ),
        result(
            'supply: sum(Balance) = TokenSupply',
            [`${sums.length} tokens compared (all rows, current state)`],
            sumMismatches
        ),
    ];
};

const checkBalances = async (ctx: Ctx): Promise<CheckResult[]> => {
    const { db, block } = ctx;
    const rows = await db.query(
        `select token, account, balance, last_change_block from ${db.table('Balance')} where ${chainFilter(ctx)} order by token, account`
    );
    // rows changed after the block: their value at the block is the last BalanceChange at or before it (else 0)
    const historical = await db.query(
        `select distinct on (bc.token, bc.account) bc.token, bc.account, bc.balance_after
         from ${db.table('BalanceChange')} bc
         join ${db.table('Balance')} b on b.chain_id = bc.chain_id and b.token = bc.token and b.account = bc.account
         where bc.${chainFilter(ctx)} and b.last_change_block > ${block} and bc.block_number <= ${block}
         order by bc.token, bc.account, bc.block_number desc, bc.log_index desc`
    );
    const historicalOf = new Map(
        R.map(historical, (row) => [`${row.token}-${row.account}`, big(row.balance_after) ?? 0n] as const)
    );
    const expected = R.map(rows, (row) => ({
        token: row.token as string,
        account: row.account as string,
        balance:
            (big(row.last_change_block) ?? 0n) <= block
                ? (big(row.balance) ?? 0n)
                : (historicalOf.get(`${row.token}-${row.account}`) ?? 0n),
        later: (big(row.last_change_block) ?? 0n) > block,
    }));
    const reads = await ctx.rpc.read(
        R.map(expected, (row) => ({
            address: row.token,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [row.account],
        })),
        block
    );
    const mismatches = R.pipe(
        expected,
        R.map((row, index) => {
            const read = reads[index];
            const label = `${row.token} (${ctx.shareKindOf.get(row.token) ?? 'not a share'}) ${row.account}`;
            if (!read?.ok) return `${label}: balanceOf() reverted, db ${row.balance}`;
            return read.value === row.balance ? undefined : `${label}: chain ${read.value} != db ${row.balance}`;
        }),
        R.filter((line) => line !== undefined)
    );

    // internal consistency of the step function
    const [latest, steps, zero] = await Promise.all([
        db.query(
            `select b.token, b.account, b.balance, b.last_change_block, l.balance_after, l.block_number
             from ${db.table('Balance')} b
             left join lateral (
                select balance_after, block_number from ${db.table('BalanceChange')} bc
                where bc.chain_id = b.chain_id and bc.token = b.token and bc.account = b.account
                order by bc.block_number desc, bc.log_index desc limit 1
             ) l on true
             where b.${chainFilter(ctx)}
               and (l.balance_after is null or l.balance_after <> b.balance or l.block_number <> b.last_change_block)`
        ),
        db.query(
            `select id, delta, balance_after, prev from (
                select id, delta, balance_after,
                       lag(balance_after) over (partition by token, account order by block_number, log_index) as prev
                from ${db.table('BalanceChange')} where ${chainFilter(ctx)}
             ) t where balance_after <> coalesce(prev, 0) + delta or delta = 0`
        ),
        db.query(
            `select 'Balance' as t, id from ${db.table('Balance')} where ${chainFilter(ctx)} and (account = '${ZERO_ADDRESS}' or balance < 0)
             union all
             select 'BalanceChange', id from ${db.table('BalanceChange')} where ${chainFilter(ctx)} and account = '${ZERO_ADDRESS}'`
        ),
    ]);
    return [
        result(
            'balances: Balance vs balanceOf()',
            [
                `${expected.length} Balance rows checked at block ${block} (${R.filter(expected, (row) => row.later).length} changed later: checked with their BalanceChange value at the block)`,
            ],
            mismatches
        ),
        result(
            'balances: internal consistency',
            ['Balance = latest BalanceChange, balanceAfter = previous + delta, no zero delta, no 0x0 / negative rows'],
            [
                ...R.map(
                    latest,
                    (row) =>
                        `Balance ${row.token} ${row.account}: ${row.balance} @${row.last_change_block} != latest BalanceChange ${row.balance_after ?? 'none'} @${row.block_number ?? '-'}`
                ),
                ...R.map(
                    steps,
                    (row) =>
                        `BalanceChange ${row.id}: balanceAfter ${row.balance_after} != previous ${row.prev ?? 0} + delta ${row.delta}`
                ),
                ...R.map(zero, (row) => `${row.t} ${row.id}: 0x0 account or negative balance`),
            ]
        ),
    ];
};

const DB_EVENT_QUERIES: Record<EventCategory, { table: string; columns: string }> = {
    ShareTransfer: { table: 'ShareTransfer', columns: 'token as emitter, from_address, to_address, value' },
    BoostStake: { table: 'BoostStake', columns: 'boost as emitter, "user", amount, direction' },
    ClmDeposit: { table: 'ClmDeposit', columns: 'manager as emitter, "user", shares, amount0, amount1, fee0, fee1' },
    ClmWithdraw: { table: 'ClmWithdraw', columns: 'manager as emitter, "user", shares, amount0, amount1' },
};

const checkEvents = async (ctx: Ctx): Promise<CheckResult[]> => {
    const { db, block, chain } = ctx;
    const boosts = new Set(R.filter(ctx.shareTokens, (address) => ctx.shareKindOf.get(address) === 'BOOST'));
    const sets = {
        transferTokens: new Set(R.filter(ctx.shareTokens, (address) => !boosts.has(address))),
        boosts,
        managers: new Set(R.filter(ctx.shareTokens, (address) => ctx.shareKindOf.get(address) === 'CLM_MANAGER')),
    };
    const addresses = R.unique([...sets.transferTokens, ...sets.boosts, ...sets.managers]).sort();
    const logs =
        addresses.length === 0
            ? []
            : await fetchLogs(
                  ctx,
                  addresses,
                  [TOPICS.transfer, TOPICS.staked, TOPICS.withdrawn, TOPICS.clmDeposit, TOPICS.clmWithdraw],
                  chain.startBlock,
                  block,
                  'events'
              );
    const byCategory = R.groupBy(logs, (log) => classifyLog(log, sets));

    const categories: EventCategory[] = ['ShareTransfer', 'BoostStake', 'ClmDeposit', 'ClmWithdraw'];
    return mapLimit(categories, 1, async (category) => {
        const { table, columns } = DB_EVENT_QUERIES[category];
        const rows = await db.query(
            `select trx_hash, log_index, block_number, ${columns} from ${db.table(table)} where ${chainFilter(ctx)} and block_number <= ${block}`
        );
        const chainLogs = byCategory[category] ?? [];
        const chainByKey = new Map(
            R.map(chainLogs, (log) => [eventKey(log.transactionHash, log.logIndex), log] as const)
        );
        const dbByKey = new Map(
            R.map(rows, (row) => [eventKey(row.trx_hash as string, row.log_index as string), row] as const)
        );
        const { missing, extra, matched } = diffKeys(new Set(chainByKey.keys()), new Set(dbByKey.keys()));
        const fieldErrors = R.pipe(
            matched,
            R.flatMap((key) =>
                R.map(
                    fieldMismatches(
                        expectedRowFields(category, chainByKey.get(key) as ChainLog),
                        dbByKey.get(key) as Row
                    ),
                    (line) => `${key} ${line}`
                )
            )
        );
        const counts = countMismatches(
            R.map(chainLogs, (log) => log.address),
            R.map(rows, (row) => row.emitter as string)
        );
        return result(
            `events: ${category} vs chain logs`,
            [
                `${chainLogs.length} logs on chain, ${rows.length} rows (blocks ${chain.startBlock}..${block}, ${category === 'ShareTransfer' ? sets.transferTokens.size : category === 'BoostStake' ? sets.boosts.size : sets.managers.size} emitters)`,
                `${matched.length} matched, ${missing.length} missing in db, ${extra.length} extra in db, ${fieldErrors.length} field mismatches, ${counts.length} emitters with different counts`,
            ],
            [
                ...R.map(counts, (line) => `count ${line}`),
                ...R.map(missing, (key) => `missing in db: ${key} (${chainByKey.get(key)?.address})`),
                ...R.map(extra, (key) => `extra in db: ${key} (${dbByKey.get(key)?.emitter})`),
                ...fieldErrors,
            ]
        );
    });
};

const checkFields = async (ctx: Ctx): Promise<CheckResult[]> => {
    const { db, block } = ctx;
    const tables = R.keys(EVENT_TABLES);
    const counts = await db.query(
        R.map(
            tables,
            (table) =>
                `select '${table}' as t, count(*) as n from ${db.table(table)} where ${chainFilter(ctx)} and block_number <= ${block}`
        ).join(' union all ')
    );
    const sizes = sampleSizes(
        R.pipe(
            counts,
            R.map((row) => [row.t as string, Number(row.n)] as [string, number]),
            R.fromEntries()
        ),
        ctx.args.sample
    );
    const sampled = (
        await mapLimit(R.entries(sizes), 2, async ([table, size]) => {
            const spec = EVENT_TABLES[table] as (typeof EVENT_TABLES)[string];
            const rows = await db.query(
                `select id, ${spec.emitter} as emitter, block_number, extract(epoch from block_timestamp)::bigint as ts,
                        trx_hash, trx_from, log_index
                 from ${db.table(table)} where ${chainFilter(ctx)} and block_number <= ${block}
                 order by random() limit ${size}`
            );
            return R.map(rows, (row) => ({ table, row }));
        })
    ).flat();

    const hashes = R.unique(R.map(sampled, ({ row }) => row.trx_hash as string));
    const receipts = new Map(
        await mapLimit(hashes, ctx.args.concurrency, async (hash) => {
            try {
                const receipt = await withRetry(() => ctx.rpc.client.getTransactionReceipt({ hash: hash as Hex }));
                return [hash, receipt] as const;
            } catch {
                return [hash, undefined] as const;
            }
        })
    );
    const blockNumbers = R.unique(R.map(sampled, ({ row }) => row.block_number as string));
    const timestamps = new Map(
        await mapLimit(blockNumbers, ctx.args.concurrency, async (number) => {
            const fetched = await withRetry(() => ctx.rpc.client.getBlock({ blockNumber: BigInt(number) }));
            return [number, fetched.timestamp] as const;
        })
    );

    const mismatches = R.pipe(
        sampled,
        R.flatMap(({ table, row }) => {
            const spec = EVENT_TABLES[table] as (typeof EVENT_TABLES)[string];
            const label = `${table} ${row.id}`;
            const receipt = receipts.get(row.trx_hash as string);
            if (!receipt) return [`${label}: transaction receipt not found`];
            const logIndex = Number(row.log_index);
            const log = R.find(receipt.logs, (entry) => entry.logIndex === logIndex);
            const id = `${ctx.db.chainId}-${row.trx_hash}-${logIndex}`;
            const errors = [
                ...((spec.idSuffix ? (row.id as string).startsWith(`${id}-`) : row.id === id)
                    ? []
                    : [`id does not match chainId-trxHash-logIndex`]),
                ...(log ? [] : [`no log ${logIndex} in the receipt`]),
                ...(log && log.address.toLowerCase() !== row.emitter
                    ? [`emitter: chain ${log.address.toLowerCase()} != db ${row.emitter}`]
                    : []),
                ...(log && !spec.topics.includes((log.topics[0] ?? '').toLowerCase())
                    ? [`topic0 ${log.topics[0]} is not an event of ${table}`]
                    : []),
                ...fieldMismatches(
                    {
                        block_number: receipt.blockNumber,
                        trx_from: receipt.from,
                        ts: timestamps.get(row.block_number as string),
                    },
                    row
                ),
            ];
            return R.map(errors, (error) => `${label}: ${error}`);
        })
    );
    const perTable = R.pipe(
        R.entries(sizes),
        R.map(([table, size]) => `${table} ${size}`)
    ).join(', ');
    return [
        result(
            'fields: sampled event rows vs receipts and blocks',
            [
                `${sampled.length} rows sampled (${perTable || 'no rows'}), ${hashes.length} receipts, ${blockNumbers.length} blocks`,
            ],
            mismatches
        ),
    ];
};

const checkClmPoolState = async (ctx: Ctx): Promise<CheckResult[]> => {
    const { db, block } = ctx;
    const [missing, orphans] = await Promise.all([
        db.query(
            `select e.strategy, e.block_number from (
                select strategy, block_number from ${db.table('ClmTvl')} where ${chainFilter(ctx)} and block_number <= ${block}
                union
                select strategy, block_number from ${db.table('Harvest')} where ${chainFilter(ctx)} and kind = 'CLM_HARVEST' and block_number <= ${block}
             ) e
             left join ${db.table('ClmPoolState')} p on p.${chainFilter(ctx)} and p.strategy = e.strategy and p.block_number = e.block_number
             where p.id is null order by e.block_number`
        ),
        db.query(
            `select p.id from ${db.table('ClmPoolState')} p
             where p.${chainFilter(ctx)} and p.block_number <= ${block}
               and not exists (select 1 from ${db.table('ClmTvl')} t where t.chain_id = p.chain_id and t.strategy = p.strategy and t.block_number = p.block_number)
               and not exists (select 1 from ${db.table('Harvest')} h where h.chain_id = p.chain_id and h.strategy = p.strategy and h.block_number = p.block_number and h.kind = 'CLM_HARVEST')`
        ),
    ]);
    const size = Math.max(10, Math.ceil(ctx.args.sample / 4));
    const rows = await db.query(
        `select id, strategy, status, price, range_lower, range_upper, token0_bal, token1_bal, main_amount0, main_amount1,
                alt_amount0, alt_amount1, block_number
         from ${db.table('ClmPoolState')} where ${chainFilter(ctx)} and block_number <= ${block}
         order by random() limit ${size}`
    );
    const valueErrors = (
        await mapLimit(rows, ctx.args.concurrency, async (row) => {
            const strategy = row.strategy as string;
            const [price, range, balances] = await ctx.rpc.read(
                R.map(['price', 'range', 'balancesOfPool'], (functionName) => ({
                    address: strategy,
                    abi: clmStrategyAbi,
                    functionName,
                })),
                BigInt(row.block_number as string)
            );
            const ok = Boolean(price?.ok && range?.ok && balances?.ok);
            if (row.status === 'FAILED') {
                return ok ? [`${row.id}: status FAILED but every read succeeds at the block`] : [];
            }
            if (!ok) return [`${row.id}: status ${row.status} but a read reverts at the block`];
            const rangeValues = (range as { value: readonly bigint[] }).value;
            const balanceValues = (balances as { value: readonly bigint[] }).value;
            return R.map(
                fieldMismatches(
                    {
                        price: (price as { value: bigint }).value,
                        range_lower: rangeValues[0],
                        range_upper: rangeValues[1],
                        token0_bal: balanceValues[0],
                        token1_bal: balanceValues[1],
                        main_amount0: balanceValues[2],
                        main_amount1: balanceValues[3],
                        alt_amount0: balanceValues[4],
                        alt_amount1: balanceValues[5],
                    },
                    row
                ),
                (line) => `${row.id}: ${line}`
            );
        })
    ).flat();
    return [
        result(
            'clm-pool-state: one row per CLM TVL / Harvest block',
            [`${missing.length} (strategy, block) pairs without a row, ${orphans.length} rows without such an event`],
            [
                ...R.map(missing, (row) => `missing ClmPoolState ${row.strategy} @${row.block_number}`),
                ...R.map(orphans, (row) => `ClmPoolState ${row.id} has no CLM TVL / Harvest event at its block`),
            ]
        ),
        result(
            'clm-pool-state: sampled rows vs price() / range() / balancesOfPool()',
            [`${rows.length} rows re-read at their block`],
            valueErrors
        ),
    ];
};

const checkCoverage = async (ctx: Ctx): Promise<CheckResult[]> => {
    const { db, block, chain } = ctx;
    const counts = await db.query(
        R.map(
            ENTITY_TABLES,
            (table) => `select '${table}' as t, count(*) as n from ${db.table(table)} where ${chainFilter(ctx)}`
        ).join(' union all ')
    );
    const kinds = R.pipe(
        ctx.contracts,
        R.countBy((contract) => contract.kind),
        R.entries(),
        R.sortBy(([kind]) => kind),
        R.map(([kind, count]) => `${kind} ${count}`)
    );

    // static config addresses (factories excluded: they get no Contract row)
    const statics = R.pipe(
        chain.contracts,
        R.filter(({ name }) => !name.endsWith('Factory')),
        R.uniqueBy(({ address }) => address)
    );
    const missing = R.filter(statics, ({ address }) => !ctx.kindOf.has(address));
    const kindMismatches = R.pipe(
        statics,
        R.filter(({ name, address }) => {
            const actual = ctx.kindOf.get(address);
            const expected = CONFIG_KIND[name];
            return actual !== undefined && expected !== undefined && actual !== expected;
        }),
        R.map(
            ({ name, address }) => `${address}: listed as ${name}, Contract.kind ${ctx.kindOf.get(address) ?? 'none'}`
        )
    );
    // a static contract gets its row at its first handled event: only those with one before the block are missing
    const logs =
        missing.length === 0
            ? []
            : await fetchLogs(
                  ctx,
                  R.map(missing, ({ address }) => address),
                  handledEventTopics(ctx.configYaml),
                  chain.startBlock,
                  block,
                  'coverage'
              );
    const firstEvent = R.pipe(
        logs,
        R.groupBy((log) => log.address),
        R.mapValues((group) => R.firstBy(group, (log) => log.blockNumber)?.blockNumber)
    );
    const missingWithEvents = R.filter(missing, ({ address }) => firstEvent[address] !== undefined);

    // facts and metadata are read at `latest` by the indexer: confirm against the chain's current state
    const latest = await ctx.rpc.client.getBlockNumber();
    const partialAll = R.filter(ctx.contracts, (contract) => contract.factsStatus === 'PARTIAL');
    const partialReads = R.flatMap(partialAll, (contract) =>
        R.map(FACT_READS[contract.kind] ?? [], (functionName) => ({
            address: contract.address,
            abi: factsAbi as Abi,
            functionName,
        }))
    );
    const partialAnswers = R.pipe(
        R.zip(partialReads, await ctx.rpc.read(partialReads, latest)),
        R.filter(([, read]) => hasOnChainValue(read)),
        R.map(([call]) => call.address)
    );
    // incomplete on chain too (e.g. a factory clone never initialized): faithful, informational only
    const partial = R.filter(
        partialAll,
        (contract) => !(contract.kind in FACT_READS) || partialAnswers.includes(contract.address)
    );
    const emptyOnChain = R.filter(partialAll, (contract) => !partial.includes(contract));
    const tokenOf = new Map(R.map(ctx.tokens, (token) => [token.address, token] as const));
    const shareWithoutToken = R.filter(
        ctx.shareTokens,
        (address) => SHARE_KINDS.has(ctx.kindOf.get(address) ?? '') && !tokenOf.get(address)?.isBeefyShare
    );
    const tokenProblemsAll = R.pipe(
        ctx.tokens,
        R.filter((token) => token.isBeefyShare),
        R.flatMap((token) => {
            const kind = ctx.kindOf.get(token.address);
            const problems =
                kind === 'BOOST'
                    ? [...(token.decimals === null ? ['boost without decimals (from BOOST_STAKED)'] : [])]
                    : [
                          ...(token.metadataStatus !== 'OK' ? [`metadataStatus ${token.metadataStatus}`] : []),
                          ...(token.decimals === null ? ['no decimals'] : []),
                          ...(token.symbol === null || token.symbol === '' ? ['symbol'] : []),
                          ...(token.name === null || token.name === '' ? ['name'] : []),
                      ];
            return R.map(problems, (problem) => ({ address: token.address, kind, problem }));
        })
    );
    const missingTextReads = R.pipe(
        tokenProblemsAll,
        R.filter(({ problem }) => problem === 'name' || problem === 'symbol'),
        R.map(({ address, problem }) => ({ address, abi: factsAbi as Abi, functionName: problem }))
    );
    const textOnChain = R.pipe(
        R.zip(missingTextReads, await ctx.rpc.read(missingTextReads, latest)),
        R.map(([call, read]) => [`${call.address}-${call.functionName}`, hasOnChainValue(read)] as const),
        R.fromEntries()
    );
    const isEmptyText = ({ address, problem }: { address: string; problem: string }) =>
        (problem === 'name' || problem === 'symbol') && textOnChain[`${address}-${problem}`] === false;
    const tokenProblems = R.pipe(
        tokenProblemsAll,
        R.filter((entry) => !isEmptyText(entry)),
        R.map(({ address, kind, problem }) => {
            const label = problem === 'name' || problem === 'symbol' ? `no ${problem}` : problem;
            return `${address} (${kind ?? 'no Contract row'}): ${label}`;
        })
    );
    const emptyTextOnChain = R.filter(tokenProblemsAll, isEmptyText);
    const invalidUnderlying = R.filter(ctx.tokens, (token) => !token.isBeefyShare && token.metadataStatus !== 'OK');

    return [
        result(
            'coverage: static config addresses have a Contract row',
            [
                `rows: ${R.map(counts, (row) => `${row.t} ${row.n}`).join(', ')}`,
                `contracts per kind: ${kinds.join(', ') || 'none'}`,
                `${statics.length} static addresses, ${missing.length} without a Contract row (${missing.length - missingWithEvents.length} without a handled event before block ${block}: expected)`,
            ],
            [
                ...R.map(
                    missingWithEvents,
                    ({ name, address }) =>
                        `${address} (${name}): no Contract row, first handled event at block ${firstEvent[address]}`
                ),
                ...kindMismatches,
            ]
        ),
        result(
            'coverage: one-time facts complete',
            [
                `${partialAll.length} contracts with factsStatus PARTIAL, ${emptyOnChain.length} of them empty on chain too (informational): ${R.map(
                    emptyOnChain,
                    (contract) => `${contract.address} (${contract.kind})`
                ).join(', ')}`,
            ],
            R.map(partial, (contract) => `${contract.address} (${contract.kind}): factsStatus PARTIAL`)
        ),
        result(
            'coverage: share token metadata',
            [
                `${R.filter(ctx.tokens, (token) => token.isBeefyShare).length} share Token rows, ${ctx.tokens.length} Token rows`,
                `${emptyTextOnChain.length} missing name/symbol values empty on chain too (informational): ${R.map(
                    emptyTextOnChain,
                    ({ address, problem }) => `${address} ${problem}`
                ).join(', ')}`,
                `${invalidUnderlying.length} non-share tokens with INVALID metadata (informational): ${R.take(
                    R.map(invalidUnderlying, (token) => token.address),
                    5
                ).join(', ')}`,
            ],
            [
                ...R.map(shareWithoutToken, (address) => `${address}: share contract without a share Token row`),
                ...tokenProblems,
            ]
        ),
    ];
};

const CHECKS: Record<CheckName, (ctx: Ctx) => Promise<CheckResult[]>> = {
    supply: checkSupply,
    balances: checkBalances,
    events: checkEvents,
    fields: checkFields,
    'clm-pool-state': checkClmPoolState,
    coverage: checkCoverage,
};

// ---------------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------------

/** Envio's progress for the chain: `progress_block` is the last block whose events are all processed and stored. */
const loadProgress = async (db: Db) => {
    const [row] = await db.query(
        `select start_block, end_block, progress_block, source_block, events_processed from ${db.table('envio_chains')} where id = ${db.chainId}`
    );
    if (!row) throw new Error(`chain ${db.chainId} not found in envio_chains`);
    return {
        startBlock: big(row.start_block),
        endBlock: big(row.end_block),
        progressBlock: big(row.progress_block) ?? -1n,
        sourceBlock: big(row.source_block),
        eventsProcessed: row.events_processed,
    };
};

const main = async () => {
    const env = process.env;
    const args = parseArgs(process.argv.slice(2), env);
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const configYaml = readFileSync(isAbsolute(args.config) ? args.config : join(root, args.config), 'utf8');
    const chain = parseChainConfig(configYaml, args.chainId);
    if (!chain) throw new Error(`chain ${args.chainId} not found in ${args.config}`);

    const db = createDb(env, args.schema, args.chainId);
    const progress = await loadProgress(db);
    const block = args.block ?? progress.progressBlock;
    console.log(
        `chain ${args.chainId}, schema ${args.schema}: envio_chains progress_block ${progress.progressBlock} (start ${progress.startBlock}, end ${progress.endBlock ?? '-'}, source ${progress.sourceBlock}, ${progress.eventsProcessed} events)`
    );
    if (block < chain.startBlock) {
        throw new Error(`block ${block} is before the chain start block ${chain.startBlock}: nothing is indexed yet`);
    }
    if (block > progress.progressBlock) {
        console.log(`WARNING: --block ${block} is after progress_block ${progress.progressBlock}: data is incomplete`);
    }
    console.log(`checking at block ${block}, RPC ${new URL(args.rpc).host}, checks: ${args.only.join(', ')}\n`);

    const [contractRows, tokenRows] = await Promise.all([
        db.query(
            `select address, kind, facts_status, created_block from ${db.table('Contract')} where chain_id = ${args.chainId}`
        ),
        db.query(
            `select address, decimals, symbol, name, metadata_status, is_beefy_share from ${db.table('Token')} where chain_id = ${args.chainId}`
        ),
    ]);
    const contracts = R.map(contractRows, (row) => ({
        address: row.address as string,
        kind: row.kind as string,
        factsStatus: row.facts_status ?? null,
        createdBlock: big(row.created_block),
    }));
    const tokens = R.map(tokenRows, (row) => ({
        address: row.address as string,
        decimals: row.decimals ?? null,
        symbol: row.symbol ?? null,
        name: row.name ?? null,
        metadataStatus: row.metadata_status ?? null,
        isBeefyShare: row.is_beefy_share === 't' || row.is_beefy_share === 'true',
    }));
    const kindOf = new Map(R.map(contracts, (contract) => [contract.address, contract.kind] as const));
    const staticShares = R.pipe(
        chain.contracts,
        R.map(({ name, address }) => ({ address, kind: CONFIG_KIND[name] ?? '' })),
        R.filter(({ kind }) => SHARE_KINDS.has(kind))
    );
    const shareTokens = R.pipe(
        [
            ...R.pipe(
                contracts,
                R.filter((contract) => SHARE_KINDS.has(contract.kind)),
                R.map((contract) => contract.address)
            ),
            ...R.pipe(
                tokens,
                R.filter((token) => token.isBeefyShare),
                R.map((token) => token.address)
            ),
            ...R.map(staticShares, ({ address }) => address),
        ],
        R.unique(),
        R.sort((a, b) => a.localeCompare(b))
    );
    // kind of each share token: its Contract row, else its config listing (a static contract the indexer missed)
    const shareKindOf = new Map(
        R.map(shareTokens, (address) => {
            const listed = R.find(staticShares, (entry) => entry.address === address);
            return [address, kindOf.get(address) ?? listed?.kind ?? 'TOKEN?'] as const;
        })
    );
    const ctx: Ctx = {
        args,
        db,
        rpc: createRpc(args.rpc, args.concurrency),
        block,
        chain,
        configYaml,
        contracts,
        tokens,
        kindOf,
        shareKindOf,
        shareTokens,
    };

    const results: CheckResult[] = [];
    for (const name of args.only) {
        const startedAt = Date.now();
        process.stderr.write(`running ${name}...\n`);
        const checkResults = await CHECKS[name](ctx).catch((error: unknown) => [
            result(name, ['check crashed'], [errorText(error).slice(0, 500)]),
        ]);
        for (const checkResult of checkResults) {
            console.log(formatResult(checkResult));
            results.push(checkResult);
        }
        process.stderr.write(`  ${name} took ${Math.round((Date.now() - startedAt) / 1000)} s\n`);
    }
    const failed = R.filter(results, (check) => check.status === 'FAIL');
    console.log(`\n${results.length - failed.length} PASS, ${failed.length} FAIL at block ${block}`);
    process.exitCode = failed.length > 0 ? 1 : 0;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}
