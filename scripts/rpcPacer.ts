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
 * Usage: pnpm rpc-pacer --upstream <url> [--port 8545] [--rps 5] [--max-rps 50] [--concurrency 4]
 *        then point ENVIO_RPC_URL_<chain> at http://localhost:<port>
 */
import http from 'node:http';
import * as R from 'remeda';

type Options = { upstream: string; port: number; rps: number; maxRps: number; minRps: number; concurrency: number };
type Answer = { status: number; text: string };

const MAX_ATTEMPTS = 12;
const MAX_BACKOFF_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 60_000;
const SUCCESSES_PER_RATE_STEP = 20;
// Concurrent requests hit the same limit together: one burst of rate-limited answers counts as one slowdown.
const RATE_DECREASE_COOLDOWN_MS = 10_000;

const RATE_LIMIT_RE = /rate.?limit|too many requests|exceeded.*(limit|quota|capacity)|-32005|-32029|throttl/i;
const TRANSIENT_RE = /timeout|timed out|temporarily unavailable|-32603.*(failsafe|upstream)/i;

/** How the proxy treats an upstream answer: pass it through, slow down and retry, or just retry. */
export const classifyAnswer = ({ status, text }: Answer): 'ok' | 'rate-limited' | 'transient' => {
    if (status === 429 || RATE_LIMIT_RE.test(text)) return 'rate-limited';
    if (status === 0 || status >= 500 || TRANSIENT_RE.test(text)) return 'transient';
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

const parseOptions = (argv: string[]): Options => {
    const args = R.pipe(
        argv,
        R.chunk(2),
        R.map(([key, value]) => [String(key).replace(/^--/, ''), String(value)] as const),
        R.fromEntries()
    ) as Record<string, string | undefined>;
    if (!args.upstream)
        throw new Error('usage: rpc-pacer --upstream <url> [--port] [--rps] [--max-rps] [--concurrency]');
    const rps = Number(args.rps ?? 5);
    return {
        upstream: args.upstream,
        port: Number(args.port ?? 8545),
        rps,
        maxRps: Number(args['max-rps'] ?? 50),
        minRps: Number(args['min-rps'] ?? 0.2),
        concurrency: Number(args.concurrency ?? 4),
    };
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

    const callUpstream = async (body: string): Promise<Answer & { retryAfter: string | null }> => {
        await acquire();
        try {
            await pace();
            stats.upstreamCalls++;
            const response = await fetch(options.upstream, {
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
            return { status: 0, text: String(error), retryAfter: null };
        } finally {
            release();
        }
    };

    const forward = async (body: string): Promise<Answer> => {
        for (let attempt = 0; ; attempt++) {
            const answer = await callUpstream(body);
            const kind = classifyAnswer(answer);
            if (kind === 'ok') {
                rate.onSuccess();
                return answer;
            }
            if (kind === 'rate-limited') {
                stats.rateLimited++;
                rate.onRateLimited();
            }
            if (attempt + 1 >= MAX_ATTEMPTS) {
                stats.failures++;
                return { status: answer.status || 502, text: answer.text };
            }
            stats.retries++;
            const delay = retryDelayMs(attempt, answer.retryAfter);
            if (kind === 'rate-limited') pausedUntil = Math.max(pausedUntil, Date.now() + delay);
            await sleep(delay);
        }
    };

    const call = async (method: string, params: unknown[]) => {
        const { text } = await forward(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
        return (JSON.parse(text) as { result?: unknown }).result;
    };

    const fullBlocks = new Map<string, Promise<unknown>>();
    const recoverTransaction = async (hash: string) => {
        const receipt = (await call('eth_getTransactionReceipt', [hash])) as { blockNumber: string } | null;
        if (!receipt) return null;
        const cached = fullBlocks.get(receipt.blockNumber);
        const block = cached ?? call('eth_getBlockByNumber', [receipt.blockNumber, true]);
        if (!cached) {
            fullBlocks.set(receipt.blockNumber, block);
            if (fullBlocks.size > 2_000) fullBlocks.delete(fullBlocks.keys().next().value as string);
        }
        const transactions = ((await block) as { transactions?: unknown[] } | null)?.transactions ?? [];
        return (
            transactions.find(
                (tx): tx is { hash: string } =>
                    typeof tx === 'object' && tx !== null && 'hash' in tx && tx.hash === hash
            ) ?? null
        );
    };

    const answer = async (body: string): Promise<Answer> => {
        const forwarded = await forward(body);
        try {
            const request = JSON.parse(body) as { method?: string; params?: unknown[] };
            const response = JSON.parse(forwarded.text) as { result?: unknown };
            if (request.method !== 'eth_getTransactionByHash' || response.result !== null) return forwarded;
            const recovered = await recoverTransaction(String(request.params?.[0]));
            if (!recovered) return forwarded;
            stats.recoveredTransactions++;
            return { status: 200, text: JSON.stringify({ ...response, result: recovered }) };
        } catch {
            return forwarded;
        }
    };

    http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
            stats.requests++;
            const { status, text } = await answer(Buffer.concat(chunks).toString('utf8'));
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(text);
        });
    }).listen(options.port, () => {
        console.log(`pacing ${options.upstream} on http://localhost:${options.port} (start ${options.rps} req/s)`);
    });

    setInterval(() => {
        console.log(
            new Date().toISOString(),
            JSON.stringify({ ...stats, rps: Number(rate.rate.toFixed(2)), inFlight, waiting: waiting.length })
        );
    }, 30_000);
};

if (import.meta.main) startPacer(parseOptions(process.argv.slice(2)));
