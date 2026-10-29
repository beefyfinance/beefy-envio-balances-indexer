/**
 * Local JSON-RPC pacing proxy for RPC-only runs against rate-limited endpoints (public RPCs, shared tokens).
 *
 * Envio's RPC source has no request-rate or concurrency setting (up to 100 requests in flight per chain), and it reads
 * a rate-limited or `null` answer as the provider lagging behind, after which a chain can stop making progress. This
 * proxy sits between Envio (and the indexer's effects) and the upstream:
 *
 * - paces requests with a token bucket and a concurrency cap; the rate adapts (halved on every rate-limited answer,
 *   raised again after a streak of successes), so it settles on what the upstream tolerates;
 * - retries rate-limited answers, timeouts, 5xx and network errors with backoff, honouring `Retry-After`;
 * - answers `eth_getTransactionByHash` from the full block when the upstream returns `null` for an existing
 *   transaction (some nodes drop the transaction-hash index for older blocks but still serve receipts and blocks).
 *
 * Production uses rpc.beefy.com (eRPC), which does this upstream; this is for local runs and correctness checks.
 *
 * Several upstreams (comma separated) are tried in turn on retries.
 *
 * Usage: pnpm rpc-pacer --upstream <url>[,<url>] [--port 8545] [--rps 5] [--max-rps 50] [--min-rps 0.2]
 *        [--concurrency 4]   (pnpm rpc-pacer --help)
 *        then point ENVIO_RPC_URL_<chain> at http://127.0.0.1:<port> (it listens on loopback only)
 *
 * Upstream answers are read through zod schemas (only the fields the recovery uses; the rest is passed through as
 * received), and every JSON body the proxy writes comes from JSON.stringify.
 */
import http from 'node:http';

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
// Concurrent requests hit the same limit together: one burst of rate-limited answers counts as one slowdown.
const RATE_DECREASE_COOLDOWN_MS = 10_000;

const RATE_LIMIT_RE = /rate.?limit|too many requests|exceeded.*(limit|quota|capacity)|-32005|-32029|throttl/i;
const TRANSIENT_RE = /timeout|timed out|temporarily unavailable|-32603.*(failsafe|upstream)/i;
const INTERNAL_ERROR_RE = /"code"\s*:\s*-32603.*internal error/i;

/** How the proxy treats an upstream answer: pass it through, slow down and retry, retry, or retry on another upstream. */
export const classifyAnswer = ({ status, text }: Answer): 'ok' | 'rate-limited' | 'transient' | 'internal-error' => {
    if (status === 429 || RATE_LIMIT_RE.test(text)) return 'rate-limited';
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The pacer's command line (generated help: `pnpm rpc-pacer --help`). */
export const pacerCommand = () =>
    new Command('rpc-pacer')
        .description('Local JSON-RPC pacing proxy for RPC-only runs against rate-limited endpoints.')
        .requiredOption(
            '--upstream <urls>',
            'upstream RPC URL(s), comma separated, tried in turn on retries',
            httpUrlListArg
        )
        .option('--port <port>', 'port to listen on', integerArg({ min: 1, max: 65_535 }), 8545)
        .option('--rps <n>', 'initial requests per second', positiveNumberArg(10_000), 5)
        .option('--max-rps <n>', 'highest rate the pacer raises to', positiveNumberArg(10_000), 50)
        .option('--min-rps <n>', 'lowest rate the pacer slows down to', positiveNumberArg(10_000), 0.2)
        .option('--concurrency <n>', 'requests in flight at most', integerArg({ min: 1, max: 1_000 }), 4);

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

const jsonRpcRequest = z.object({ method: z.string(), params: z.array(z.unknown()).optional() });
/** The upstream answer: only `result` is read, every other field is kept as received. */
const jsonRpcAnswer = z.looseObject({ result: z.unknown() });
const transactionHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const receiptAnswer = z.object({ blockNumber: z.string().regex(/^0x[0-9a-fA-F]+$/) }).nullable();
const blockAnswer = z.object({ transactions: z.array(z.unknown()) }).nullable();
const fullTransaction = z.looseObject({ hash: transactionHash });

/** Undefined for anything that is not valid JSON. */
const parseJson = (text: string): unknown => {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
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

const startPacer = (options: Options) => {
    const rate = createRateController({ initial: options.rps, min: options.minRps, max: options.maxRps });
    const stats = { requests: 0, upstreamCalls: 0, rateLimited: 0, retries: 0, failures: 0, recoveredTransactions: 0 };

    // concurrency cap
    let inFlight = 0;
    const waiting: Array<() => void> = [];
    const acquire = () => {
        if (inFlight < options.concurrency) {
            inFlight++;
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => waiting.push(resolve));
    };
    const release = () => {
        const next = waiting.shift();
        if (next) next();
        else inFlight--;
    };

    // token bucket at the adaptive rate; `pausedUntil` holds everyone back after a rate-limited answer
    let nextSlot = 0;
    let pausedUntil = 0;
    const pace = async () => {
        const now = Date.now();
        const slot = Math.max(now, nextSlot, pausedUntil);
        nextSlot = slot + 1000 / rate.rate;
        if (slot > now) await sleep(slot - now);
    };

    const callUpstream = async (body: string, attempt: number): Promise<Answer & { retryAfter: string | null }> => {
        await acquire();
        try {
            await pace();
            stats.upstreamCalls++;
            // each retry goes to the next upstream, so one flaky node cannot keep a request failing
            const response = await fetch(options.upstreams[attempt % options.upstreams.length], {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            });
            return {
                status: response.status,
                text: await response.text(),
                retryAfter: response.headers.get('retry-after'),
            };
        } catch (error) {
            return { status: 0, text: describeError(error), retryAfter: null };
        } finally {
            release();
        }
    };

    const forward = async (body: string): Promise<Answer> => {
        for (let attempt = 0; ; attempt++) {
            const answer = await callUpstream(body, attempt);
            const kind = classifyAnswer(answer);
            if (kind === 'ok') {
                rate.onSuccess();
                return answer;
            }
            if (kind === 'rate-limited') {
                stats.rateLimited++;
                rate.onRateLimited();
            }
            const maxAttempts = kind === 'internal-error' ? INTERNAL_ERROR_ATTEMPTS : MAX_ATTEMPTS;
            if (attempt + 1 >= maxAttempts) {
                if (kind === 'internal-error') return answer;
                stats.failures++;
                return { status: answer.status || 502, text: answer.text };
            }
            stats.retries++;
            const delay = retryDelayMs(attempt, answer.retryAfter);
            if (kind === 'rate-limited') pausedUntil = Math.max(pausedUntil, Date.now() + delay);
            await sleep(delay);
        }
    };

    const call = async <T>(method: string, params: unknown[], schema: z.ZodType<T>) => {
        const { text } = await forward(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
        return readResult(text, schema);
    };

    const fullBlocks = new Map<string, Promise<unknown>>();
    const recoverTransaction = async (hash: string) => {
        const receipt = await call('eth_getTransactionReceipt', [hash], receiptAnswer);
        if (!receipt) return null;
        const cached = fullBlocks.get(receipt.blockNumber);
        const block = cached ?? call('eth_getBlockByNumber', [receipt.blockNumber, true], z.unknown());
        if (!cached) {
            fullBlocks.set(receipt.blockNumber, block);
            if (fullBlocks.size > 2_000) fullBlocks.delete(fullBlocks.keys().next().value as string);
        }
        return findTransaction(await block, hash);
    };

    const answer = async (body: string): Promise<Answer> => {
        const forwarded = await forward(body);
        try {
            const request = jsonRpcRequest.safeParse(parseJson(body));
            const response = jsonRpcAnswer.safeParse(parseJson(forwarded.text));
            if (!request.success || !response.success) return forwarded;
            if (request.data.method !== 'eth_getTransactionByHash' || response.data.result !== null) return forwarded;
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
    http.createServer((req, res) => {
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
            const { status, text } = await answer(Buffer.concat(chunks).toString('utf8'));
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(text);
        });
    }).listen(options.port, '127.0.0.1', () => {
        // hosts only: an upstream URL can hold an API key
        console.log(
            `pacing ${options.upstreams.map(redactUrl).join(', ')} on http://127.0.0.1:${options.port} (start ${options.rps} req/s)`
        );
    });

    setInterval(() => {
        console.log(
            new Date().toISOString(),
            JSON.stringify({ ...stats, rps: Number(rate.rate.toFixed(2)), inFlight, waiting: waiting.length })
        );
    }, 30_000);
};

if (import.meta.main) startPacer(parseOptions(process.argv.slice(2)));
