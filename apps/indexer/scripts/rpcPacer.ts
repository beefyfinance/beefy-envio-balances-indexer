/**
 * Local JSON-RPC pacing proxy for RPC-only runs against rate-limited endpoints (public RPCs, shared tokens).
 *
 * Envio's RPC source has no request-rate or concurrency setting (up to 100 requests in flight per chain), and it reads
 * a rate-limited or `null` answer as the provider lagging behind, after which a chain can stop making progress. This
 * proxy sits between Envio (and the indexer's effects) and the upstream:
 *
 * - paces each upstream on its own: a token bucket, a concurrency cap and a backoff per upstream; the rate adapts
 *   (halved on every rate-limited answer, raised again after a streak of successes), so each settles on what its
 *   provider tolerates;
 * - sends each request to the upstream that can take it soonest, so several upstreams add up their rates;
 * - retries rate-limited answers, timeouts, 5xx and network errors on another upstream, with backoff, honouring
 *   `Retry-After`;
 * - passes an `eth_getLogs` that an upstream refuses for its block range on to the other upstreams, and returns the
 *   refusal only when all of them refuse it (Envio then narrows the range); a refusal also sets that upstream's widest
 *   range, and wider queries go straight to the others from then on;
 * - fetches each settled block (at least `SETTLED_DEPTH` behind the head) once, with its transactions, and answers
 *   `eth_getBlockByNumber` and `eth_getTransactionByHash` for it from that copy. Envio's RPC source asks for the block
 *   and then for every transaction of an event one by one; the block of a transaction is known from the `eth_getLogs`
 *   answers that went through. Blocks near the head always go to the upstream, so reorg checks see live data;
 * - answers `eth_getTransactionByHash` from the full block when the upstream returns `null` for an existing
 *   transaction (some nodes drop the transaction-hash index for older blocks but still serve receipts and blocks);
 * - asks the other upstreams for a block up to the head one answers `null` for, or a settled one it serves without the
 *   transactions its logs prove: it pruned the block, or lost it (MegaETH's public node keeps answering `null` for
 *   blocks it has, and Envio would wait forever);
 * - drops a queued request once its client has gone: Envio cancels a query after its timeout and asks again, and an
 *   upstream's quota should not go on answers nobody reads.
 *
 * Production uses rpc.beefy.com (eRPC), which does this upstream; this is for local runs and correctness checks.
 *
 * Usage: pnpm rpc-pacer --upstream <url>[,<url>...] [--port 8545] [--rps 5] [--max-rps 50] [--min-rps 0.2]
 *        [--concurrency 4]   (pnpm rpc-pacer --help; the rates and the concurrency are per upstream)
 *        then point ENVIO_RPC_URL_<chain> at http://127.0.0.1:<port> (it listens on loopback only)
 *
 * Upstream answers are read through zod schemas (only the fields the recovery uses; the rest is passed through as
 * received), and every JSON body the proxy writes comes from JSON.stringify.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { Command } from 'commander';
import { z } from 'zod';

import { describeError, redactUrl } from '../src/lib/errors.ts';
import { httpUrlListArg, integerArg, positiveNumberArg } from './lib/cli.ts';

type Options = { upstreams: string[]; port: number; rps: number; maxRps: number; minRps: number; concurrency: number };
type Answer = { status: number; text: string };

const MAX_ATTEMPTS = 12;
// A bare "Internal error" is usually one node of a pool missing data; a few attempts on the other upstreams are
// enough, more would only delay a real error (some nodes also use it for reverts).
const INTERNAL_ERROR_ATTEMPTS = 4;
const MAX_BACKOFF_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 60_000;
/** JSON-RPC requests are small (batches included): anything bigger is refused. */
const MAX_BODY_BYTES = 1024 * 1024;
const SUCCESSES_PER_RATE_STEP = 20;
/** Blocks this far behind the head are settled: no reorg reaches them, a copy of one stays valid. */
const SETTLED_DEPTH = 1_000;
const MAX_CACHED_BLOCKS = 512;
const MAX_KNOWN_TRANSACTIONS = 200_000;
const HEAD_REFRESH_MS = 60_000;
// Concurrent requests hit the same limit together: one burst of rate-limited answers counts as one slowdown.
const RATE_DECREASE_COOLDOWN_MS = 10_000;

// providers word a refused log range in many ways: "block range too large", "ranges over 10000 blocks are not
// supported", "maximum allowed is 50 blocks", "query returned more than 10000 results"
const RANGE_RE =
    /block range|range (is )?too (large|big|wide)|ranges? over \d+ blocks|allowed is \d+ blocks|more than \d+ (results|logs)/i;
/** For the pacer's own calls, which no client can abandon. */
const NO_CLIENT = new AbortController().signal;

// a node that pruned the state a request reads: "Unknown state. First available state is 1", "missing trie node"
const NO_STATE_RE = /unknown state|missing trie node|state (is )?not available|historical state|pruned/i;
const RATE_LIMIT_RE = /rate.?limit|too many requests|exceeded.*(limit|quota|capacity)|-32005|-32029|throttl/i;
const TRANSIENT_RE = /timeout|timed out|temporarily unavailable|-32603.*(failsafe|upstream)/i;
const INTERNAL_ERROR_RE = /"code"\s*:\s*-32603.*internal error/i;
/** Refusals and errors are short: the patterns only read this much of an answer, which can be megabytes of logs. */
const CLASSIFIED_CHARS = 4096;

export type AnswerKind = 'ok' | 'rate-limited' | 'transient' | 'internal-error' | 'range-refused' | 'no-state';

/**
 * How the proxy treats an upstream answer: pass it through, slow down and retry, retry, retry on another upstream, or
 * (a log range the upstream refuses, or state it has pruned) ask the other upstreams.
 */
export const classifyAnswer = ({ status, text: whole }: Answer): AnswerKind => {
    if (status === 429) return 'rate-limited';
    const text = whole.slice(0, CLASSIFIED_CHARS);
    if (RANGE_RE.test(text)) return 'range-refused';
    if (NO_STATE_RE.test(text)) return 'no-state';
    if (RATE_LIMIT_RE.test(text)) return 'rate-limited';
    if (status === 0 || status >= 500 || TRANSIENT_RE.test(text)) return 'transient';
    if (INTERNAL_ERROR_RE.test(text)) return 'internal-error';
    return 'ok';
};

/** Exponential backoff, or the upstream's `Retry-After` (seconds) when it gives one. */
export const retryDelayMs = (attempt: number, retryAfter: string | null) => {
    const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_BACKOFF_MS, seconds * 1000);
    return Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
};

/** Additive-increase / multiplicative-decrease of the request rate, at most one decrease per cooldown window. */
export type RateController = ReturnType<typeof createRateController>;

export const createRateController = ({
    initial,
    min,
    max,
    now = Date.now,
}: {
    initial: number;
    min: number;
    max: number;
    now?: () => number;
}) => {
    let rate = initial;
    let successes = 0;
    let lastDecrease = Number.NEGATIVE_INFINITY;
    return {
        get rate() {
            return rate;
        },
        onSuccess() {
            successes++;
            if (successes >= SUCCESSES_PER_RATE_STEP) {
                successes = 0;
                rate = Math.min(max, rate + Math.max(0.5, rate * 0.1));
            }
        },
        onRateLimited() {
            successes = 0;
            if (now() - lastDecrease < RATE_DECREASE_COOLDOWN_MS) return;
            lastDecrease = now();
            rate = Math.max(min, rate / 2);
        },
    };
};

/** The pacer's command line (generated help: `pnpm rpc-pacer --help`). */
export const pacerCommand = () =>
    new Command('rpc-pacer')
        .description('Local JSON-RPC pacing proxy for RPC-only runs against rate-limited endpoints.')
        .requiredOption(
            '--upstream <urls>',
            'upstream RPC URL(s) of the same chain, comma separated; each request goes to the one free soonest',
            httpUrlListArg
        )
        .option('--port <port>', 'port to listen on', integerArg({ min: 1, max: 65_535 }), 8545)
        .option('--rps <n>', 'initial requests per second, per upstream', positiveNumberArg(10_000), 5)
        .option('--max-rps <n>', 'highest rate the pacer raises an upstream to', positiveNumberArg(10_000), 50)
        .option('--min-rps <n>', 'lowest rate the pacer slows an upstream down to', positiveNumberArg(10_000), 0.2)
        .option('--concurrency <n>', 'requests in flight at most, per upstream', integerArg({ min: 1, max: 1_000 }), 4);

/** The pacer options of `argv` (user arguments, without node and the script); throws a CommanderError when invalid. */
export const parseOptions = (argv: readonly string[], command: Command = pacerCommand()): Options => {
    const parsed = command.parse(argv, { from: 'user' }).opts<{
        upstream: string[];
        port: number;
        rps: number;
        maxRps: number;
        minRps: number;
        concurrency: number;
    }>();
    if (parsed.upstream.length === 0) command.error('error: --upstream needs at least one URL');
    if (!(parsed.minRps <= parsed.rps && parsed.rps <= parsed.maxRps)) {
        command.error('error: expected --min-rps <= --rps <= --max-rps');
    }
    return {
        upstreams: parsed.upstream,
        port: parsed.port,
        rps: parsed.rps,
        maxRps: parsed.maxRps,
        minRps: parsed.minRps,
        concurrency: parsed.concurrency,
    };
};

const jsonRpcId = z.union([z.string(), z.number(), z.null()]);
const jsonRpcRequest = z.object({
    id: jsonRpcId.optional(),
    method: z.string(),
    params: z.array(z.unknown()).optional(),
});
const hexQuantity = z.string().regex(/^0x[0-9a-fA-F]+$/);
const logsAnswer = z.array(z.looseObject({ transactionHash: z.string(), blockNumber: hexQuantity }));
const fullBlockAnswer = z.looseObject({ number: hexQuantity, transactions: z.array(z.unknown()) }).nullable();
const logsRequest = z.object({
    method: z.literal('eth_getLogs'),
    params: z.tuple([z.looseObject({ fromBlock: hexQuantity, toBlock: hexQuantity })]).rest(z.unknown()),
});

/** The number of blocks an `eth_getLogs` request covers, or undefined for anything else (or a block tag). */
export const logRangeOf = (body: string): number | undefined => {
    const request = logsRequest.safeParse(parseJson(body));
    if (!request.success) return undefined;
    const { fromBlock, toBlock } = request.data.params[0];
    return Number.parseInt(toBlock, 16) - Number.parseInt(fromBlock, 16) + 1;
};
/** The upstream answer: only `result` is read, every other field is kept as received. */
const jsonRpcAnswer = z.looseObject({ result: z.unknown() });
const transactionHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const receiptAnswer = z.object({ blockNumber: hexQuantity }).nullable();
const blockAnswer = z.object({ transactions: z.array(z.unknown()) }).nullable();
const fullTransaction = z.looseObject({ hash: transactionHash });

/** A full block (`eth_getBlockByNumber` with transactions) as the answer without them: transaction hashes only. */
export const withTransactionHashes = (block: { transactions: unknown[] }) => ({
    ...block,
    transactions: block.transactions.map((transaction) => {
        const parsed = fullTransaction.safeParse(transaction);
        return parsed.success ? parsed.data.hash : transaction;
    }),
});

/** Undefined for anything that is not valid JSON. */
export const parseJson = (text: string): unknown => {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
};

const emptyBlock = z.looseObject({ transactions: z.array(z.unknown()).length(0) });

/** The number a request names, when it asks for a block by number. */
const requestedBlock = (body: string): number | undefined => {
    const request = jsonRpcRequest.safeParse(parseJson(body));
    if (!request.success || request.data.method !== 'eth_getBlockByNumber') return undefined;
    const number = hexQuantity.safeParse(request.data.params?.[0]);
    return number.success ? Number.parseInt(number.data, 16) : undefined;
};

/** `result` of a JSON-RPC answer, validated by `schema`; undefined when the answer or its result does not fit. */
export const readResult = <T>(text: string, schema: z.ZodType<T>): T | undefined => {
    const answer = jsonRpcAnswer.safeParse(parseJson(text));
    if (!answer.success) return undefined;
    const result = schema.safeParse(answer.data.result);
    return result.success ? result.data : undefined;
};

/** The transaction of a full block whose hash is `hash`, or null. */
export const findTransaction = (block: unknown, hash: string) => {
    const parsed = blockAnswer.safeParse(block);
    if (!parsed.success || parsed.data === null) return null;
    for (const transaction of parsed.data.transactions) {
        const candidate = fullTransaction.safeParse(transaction);
        if (candidate.success && candidate.data.hash.toLowerCase() === hash.toLowerCase()) return candidate.data;
    }
    return null;
};

/** One upstream and its own pacing: rate, next free slot, pause after a rate limit, requests in flight. */
export type Upstream = {
    url: string;
    rate: RateController;
    nextSlot: number;
    pausedUntil: number;
    /** Rate-limited answers in a row: the exponent of its pause. */
    strikes: number;
    /** The widest `eth_getLogs` block range it accepts, learnt from its refusals (unknown until one). */
    maxLogRange: number | undefined;
    inFlight: number;
    stats: { calls: number; rateLimited: number; rangeRefused: number; noState: number; failed: number };
};

export const createUpstream = (url: string, rate: RateController): Upstream => ({
    url,
    rate,
    nextSlot: 0,
    pausedUntil: 0,
    strikes: 0,
    maxLogRange: undefined,
    inFlight: 0,
    stats: { calls: 0, rateLimited: 0, rangeRefused: 0, noState: 0, failed: 0 },
});

/** When `upstream` can send its next request. */
const freeAt = (upstream: Upstream, now: number) => Math.max(now, upstream.nextSlot, upstream.pausedUntil);

/**
 * The upstream a request goes to next, or undefined when it has to wait for one to free up: never one in `refused`
 * (it refused this request's log range) nor one at its concurrency cap; one this request has not `tried` yet when there
 * is any, even busy (it waits for it); then the one free soonest.
 */
export const pickUpstream = (
    upstreams: readonly Upstream[],
    {
        tried,
        refused,
        concurrency,
        now,
    }: {
        tried: ReadonlySet<Upstream>;
        refused: ReadonlySet<Upstream>;
        concurrency: number;
        now: number;
    }
): Upstream | undefined => {
    const allowed = upstreams.filter((upstream) => !refused.has(upstream));
    const untried = allowed.filter((upstream) => !tried.has(upstream));
    const pool = untried.length > 0 ? untried : allowed;
    const free = pool.filter((upstream) => upstream.inFlight < concurrency);
    if (free.length === 0) return undefined;
    return free.reduce((best, upstream) =>
        freeAt(upstream, now) < freeAt(best, now) ||
        (freeAt(upstream, now) === freeAt(best, now) && upstream.inFlight < best.inFlight)
            ? upstream
            : best
    );
};

export const startPacer = (options: Options, { headRefreshMs = HEAD_REFRESH_MS }: { headRefreshMs?: number } = {}) => {
    const upstreams = options.upstreams.map((url) =>
        createUpstream(url, createRateController({ initial: options.rps, min: options.minRps, max: options.maxRps }))
    );
    const stats = {
        requests: 0,
        upstreamCalls: 0,
        rateLimited: 0,
        retries: 0,
        failures: 0,
        recoveredTransactions: 0,
        /** Answered from a settled block's copy, without an upstream call. */
        fromBlockCache: 0,
        /** Settled blocks fetched with their transactions. */
        blocksFetched: 0,
        /** Dropped from the queue: the client had gone before an upstream was called. */
        abandoned: 0,
    };
    /** Requests received, per method. */
    const methods: Record<string, number> = {};

    // requests waiting for an upstream below its concurrency cap; all of them look again whenever one frees up
    const waiting: Array<() => void> = [];
    const wakeAll = () => {
        for (const wake of waiting.splice(0)) wake();
    };

    /** An upstream for this request, with its slot reserved (token bucket at the upstream's adaptive rate). */
    const acquire = async (tried: ReadonlySet<Upstream>, refused: ReadonlySet<Upstream>, client: AbortSignal) => {
        for (;;) {
            if (client.aborted) return undefined;
            const now = Date.now();
            const upstream = pickUpstream(upstreams, { tried, refused, concurrency: options.concurrency, now });
            if (upstream) {
                upstream.inFlight++;
                const slot = freeAt(upstream, now);
                upstream.nextSlot = slot + 1000 / upstream.rate.rate;
                return { upstream, slot };
            }
            await new Promise<void>((resolve) => waiting.push(resolve));
        }
    };

    const send = async (
        upstream: Upstream,
        slot: number,
        body: string,
        client: AbortSignal
    ): Promise<Answer & { retryAfter: string | null }> => {
        try {
            const wait = slot - Date.now();
            if (wait > 0) await sleep(wait, undefined, { signal: client });
            stats.upstreamCalls++;
            upstream.stats.calls++;
            const response = await fetch(upstream.url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                signal: AbortSignal.any([client, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
            });
            return {
                status: response.status,
                text: await response.text(),
                retryAfter: response.headers.get('retry-after'),
            };
        } catch (error) {
            return { status: 0, text: describeError(error), retryAfter: null };
        } finally {
            upstream.inFlight--;
            wakeAll();
        }
    };

    /** A block up to the head exists, and logs prove a settled one has transactions: a node answering otherwise lacks it. */
    const isPrunedBlock = (block: number, text: string) => {
        const response = jsonRpcAnswer.safeParse(parseJson(text));
        if (!response.success) return false;
        if (response.data.result === null) return head > 0 && block <= head;
        return isSettled(block) && blocksWithLogs.has(block) && emptyBlock.safeParse(response.data.result).success;
    };

    const forward = async (body: string, client: AbortSignal = NO_CLIENT): Promise<Answer> => {
        const abandon = (): Answer => {
            stats.abandoned++;
            return { status: 499, text: '' };
        };
        const tried = new Set<Upstream>();
        const block = requestedBlock(body);
        // upstreams known to refuse this log range are skipped, unless all are: one of them then gives Envio the refusal
        const logRange = logRangeOf(body);
        const tooNarrow = upstreams.filter(
            (upstream) =>
                logRange !== undefined && upstream.maxLogRange !== undefined && logRange > upstream.maxLogRange
        );
        const refused = new Set<Upstream>(tooNarrow.length < upstreams.length ? tooNarrow : []);
        // the attempt limits grow with the upstreams: each gets about as many tries as a lone upstream used to
        const maxAttempts = MAX_ATTEMPTS * upstreams.length;
        const maxInternalErrors = Math.max(INTERNAL_ERROR_ATTEMPTS, upstreams.length);
        let lastRefusal: Answer | undefined;
        for (let attempt = 0; ; attempt++) {
            // every upstream refused this log range (Envio narrows it on this answer) or lacks this state; near the head a
            // node is probably just behind, so its answer is not worth waiting out another's pause
            const now = Date.now();
            const nearHead = block !== undefined && !isSettled(block);
            const unavailable = (upstream: Upstream) =>
                refused.has(upstream) || (nearHead && upstream.pausedUntil > now);
            if (lastRefusal && upstreams.every(unavailable)) return lastRefusal;
            const acquired = await acquire(tried, refused, client);
            if (!acquired) return abandon();
            const { upstream, slot } = acquired;
            const answer = await send(upstream, slot, body, client);
            if (client.aborted) return abandon();
            tried.add(upstream);
            const kind = block !== undefined && isPrunedBlock(block, answer.text) ? 'no-state' : classifyAnswer(answer);
            if (kind === 'ok') {
                upstream.strikes = 0;
                upstream.rate.onSuccess();
                return answer;
            }
            if (kind === 'range-refused' || kind === 'no-state') {
                upstream.stats[kind === 'no-state' ? 'noState' : 'rangeRefused']++;
                if (kind === 'range-refused' && logRange !== undefined) {
                    upstream.maxLogRange = Math.min(upstream.maxLogRange ?? logRange, logRange - 1);
                }
                refused.add(upstream);
                lastRefusal = answer;
                continue;
            }
            if (kind === 'rate-limited') {
                stats.rateLimited++;
                upstream.stats.rateLimited++;
                upstream.rate.onRateLimited();
                // the pause is the upstream's: the request goes on at once to another one
                upstream.pausedUntil = Math.max(
                    upstream.pausedUntil,
                    Date.now() + retryDelayMs(upstream.strikes, answer.retryAfter)
                );
                upstream.strikes++;
            } else {
                upstream.stats.failed++;
            }
            if (attempt + 1 >= (kind === 'internal-error' ? maxInternalErrors : maxAttempts)) {
                if (kind === 'internal-error') return answer;
                stats.failures++;
                return { status: answer.status || 502, text: answer.text };
            }
            stats.retries++;
            // a failure every upstream has had a turn at: back off before the next round
            if (
                kind !== 'rate-limited' &&
                upstreams.every((candidate) => tried.has(candidate) || refused.has(candidate))
            ) {
                tried.clear();
                await sleep(retryDelayMs(Math.floor(attempt / upstreams.length), answer.retryAfter));
            }
        }
    };

    const call = async <T>(method: string, params: unknown[], schema: z.ZodType<T>) => {
        const { text } = await forward(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
        return readResult(text, schema);
    };

    // the highest block seen; 0 until known, which keeps every block out of the cache
    let head = 0;
    const isSettled = (block: number) => head > 0 && block <= head - SETTLED_DEPTH;
    const noteHead = (height: string | undefined) => {
        if (height !== undefined) head = Math.max(head, Number.parseInt(height, 16));
    };
    const refreshHead = async () => noteHead(await call('eth_blockNumber', [], hexQuantity));

    // full blocks by number, oldest first; a failed fetch is dropped so the next request tries again
    const fullBlocks = new Map<number, Promise<z.infer<typeof fullBlockAnswer> | undefined>>();
    const fullBlock = (number: number) => {
        const cached = fullBlocks.get(number);
        if (cached) return cached;
        stats.blocksFetched++;
        const block = call('eth_getBlockByNumber', [`0x${number.toString(16)}`, true], fullBlockAnswer).then(
            (found) => {
                if (!found) fullBlocks.delete(number);
                return found;
            }
        );
        fullBlocks.set(number, block);
        if (fullBlocks.size > MAX_CACHED_BLOCKS) fullBlocks.delete(fullBlocks.keys().next().value as number);
        return block;
    };

    // transaction hash to block number, from the eth_getLogs answers, oldest first
    const transactionBlocks = new Map<string, number>();
    const blocksWithLogs = new Set<number>();
    const rememberLogs = (text: string) => {
        const logs = readResult(text, logsAnswer);
        if (!logs) return;
        for (const log of logs) {
            const block = Number.parseInt(log.blockNumber, 16);
            transactionBlocks.set(log.transactionHash.toLowerCase(), block);
            blocksWithLogs.add(block);
        }
        // one iterator: a new one per eviction would walk over the deleted entries each time
        for (const [hash, block] of transactionBlocks) {
            if (transactionBlocks.size <= MAX_KNOWN_TRANSACTIONS) break;
            transactionBlocks.delete(hash);
            blocksWithLogs.delete(block);
        }
    };

    /** The answer to `request` from a settled block's copy, or undefined to ask the upstream. */
    const fromSettledBlock = async ({ id, method, params = [] }: z.infer<typeof jsonRpcRequest>) => {
        let result: unknown;
        if (method === 'eth_getBlockByNumber') {
            const number = hexQuantity.safeParse(params[0]);
            if (!number.success) return undefined;
            const blockNumber = Number.parseInt(number.data, 16);
            if (!isSettled(blockNumber)) return undefined;
            const block = await fullBlock(blockNumber);
            if (!block) return undefined;
            result = params[1] === true ? block : withTransactionHashes(block);
        } else if (method === 'eth_getTransactionByHash') {
            const hash = transactionHash.safeParse(params[0]);
            if (!hash.success) return undefined;
            const blockNumber = transactionBlocks.get(hash.data.toLowerCase());
            if (blockNumber === undefined || !isSettled(blockNumber)) return undefined;
            const block = await fullBlock(blockNumber);
            result = block ? findTransaction(block, hash.data) : null;
            if (!result) return undefined;
        } else {
            return undefined;
        }
        stats.fromBlockCache++;
        return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }) };
    };

    const recoverTransaction = async (hash: string) => {
        const receipt = await call('eth_getTransactionReceipt', [hash], receiptAnswer);
        if (!receipt) return null;
        return findTransaction(await fullBlock(Number.parseInt(receipt.blockNumber, 16)), hash);
    };

    const answer = async (body: string, client: AbortSignal): Promise<Answer> => {
        const request = jsonRpcRequest.safeParse(parseJson(body));
        if (request.success) {
            methods[request.data.method] = (methods[request.data.method] ?? 0) + 1;
            const cached = await fromSettledBlock(request.data).catch(() => undefined);
            if (cached) return cached;
        } else {
            methods['(batch or invalid)'] = (methods['(batch or invalid)'] ?? 0) + 1;
        }
        const forwarded = await forward(body, client);
        try {
            if (!request.success) return forwarded;
            if (request.data.method === 'eth_getLogs') rememberLogs(forwarded.text);
            if (request.data.method === 'eth_blockNumber') noteHead(readResult(forwarded.text, hexQuantity));
            if (request.data.method !== 'eth_getTransactionByHash') return forwarded;
            const response = jsonRpcAnswer.safeParse(parseJson(forwarded.text));
            if (!response.success || response.data.result !== null) return forwarded;
            const hash = transactionHash.safeParse(request.data.params?.[0]);
            if (!hash.success) return forwarded;
            const recovered = await recoverTransaction(hash.data);
            if (!recovered) return forwarded;
            stats.recoveredTransactions++;
            return { status: 200, text: JSON.stringify({ ...response.data, result: recovered }) };
        } catch {
            return forwarded;
        }
    };

    // loopback only: it relays to upstreams that may carry an API key, with no authentication of its own
    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                res.writeHead(413, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'request body too large' }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', async () => {
            stats.requests++;
            const client = new AbortController();
            res.on('close', () => client.abort());
            const { status, text } = await answer(Buffer.concat(chunks).toString('utf8'), client.signal);
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(text);
        });
    });
    const listening = new Promise<number>((resolve) => {
        server.listen(options.port, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            // hosts only: an upstream URL can hold an API key
            console.log(
                `pacing ${options.upstreams.map(redactUrl).join(', ')} on http://127.0.0.1:${port} (start ${options.rps} req/s each)`
            );
            resolve(port);
        });
    });

    const report = setInterval(() => {
        const rps = upstreams.reduce((sum, upstream) => sum + upstream.rate.rate, 0);
        const inFlight = upstreams.reduce((sum, upstream) => sum + upstream.inFlight, 0);
        const perUpstream = upstreams.map((upstream) => ({
            upstream: redactUrl(upstream.url),
            rps: Number(upstream.rate.rate.toFixed(2)),
            inFlight: upstream.inFlight,
            maxLogRange: upstream.maxLogRange ?? null,
            ...upstream.stats,
        }));
        console.log(
            new Date().toISOString(),
            JSON.stringify({
                ...stats,
                rps: Number(rps.toFixed(2)),
                inFlight,
                waiting: waiting.length,
                head,
                methods,
                upstreams: perUpstream,
            })
        );
    }, 30_000);
    report.unref();

    // the head decides which blocks are settled: known from the start, kept current even when no client asks for it
    const headTimer = headRefreshMs > 0 ? setInterval(() => void refreshHead(), headRefreshMs) : undefined;
    headTimer?.unref();
    if (headRefreshMs > 0) void refreshHead();

    return {
        /** The port it listens on (the one asked for, or the one the system chose for port 0). */
        listening,
        stats,
        upstreams,
        close: () =>
            new Promise<void>((resolve) => {
                clearInterval(report);
                clearInterval(headTimer);
                server.close(() => resolve());
                server.closeAllConnections();
            }),
    };
};

if (import.meta.main) startPacer(parseOptions(process.argv.slice(2)));
