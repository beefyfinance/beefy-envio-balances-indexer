/**
 * Follows one transaction from the chain to the user's screen and times every step, to see where a user waits.
 *
 * Start it before sending the transaction: it records the account's events, then waits for a new one (or for `--tx`).
 * Every step is timed from the block's timestamp:
 *
 * 1. indexed: the event's row is in Envio's history table, with or without an indexer price.
 * 2. committed: Envio's frontier passed the row: the API views can read it.
 * 3. stored: `advance` gave it a row in `event_price_<N>` (provisional above the watermark, final below it).
 * 4. watermark: the watermark passed the event.
 * 5. origin: the API's answer first holds the transaction, and each later change of its price flag.
 * 6. user: the same seen by a simulated user who refreshes every `--refresh` seconds through a browser cache and a CDN
 *    that both honour the API's `Cache-Control`, `ETag` included (`createCacheLayer`). A real user can only be slower
 *    than step 5 and this is how much.
 *
 * It ends once the user sees a final price, or after `--max-hours`. Each step and each change is printed and appended
 * to `--out` as JSON lines; Ctrl-C prints the summary so far. Read-only: it writes nothing to ClickHouse.
 *
 * Usage: node --env-file=../worker/.env scripts/watchTimeline.ts --chain 59144 --account 0x... --version 7
 *        --envio-database envio_dev_mrt_7 [--database beefy_indexer_dev_mrt] [--api http://localhost:18431]
 *        [--tx 0x...] [--refresh 30] [--poll 2] [--out watch.jsonl] [--max-hours 30]
 * ClickHouse comes from CLICKHOUSE_URL, CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD, read through fetch.
 */
/* oxlint-disable beefy/no-wall-clock -- this script measures wall clock latency */
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import {
    type Sql,
    envioChainsTable,
    eventPriceTable,
    finalPriceFlags,
    param,
    priceWatermarkTable,
    qualified,
    sql,
    timelineEventHistoryTable,
} from '@beefy/clickhouse';
import { Command } from 'commander';
import * as R from 'remeda';
import { z } from 'zod';

import { describeError } from '../src/lib/errors.ts';
import { type ClickHouseClient, createClickHouseClient } from './integrity/clickhouse.ts';
import { chainIdArg, httpUrlArg, identifierArg, integerArg } from './lib/cli.ts';
import { parseJson } from './rpcPacer.ts';

/** What one HTTP cache keeps from `Cache-Control`, in seconds. */
export type Freshness = { maxAge: number; sMaxAge: number | undefined; staleWhileRevalidate: number };

export const parseCacheControl = (header: string | null): Freshness => {
    const seconds = (name: string): number | undefined => {
        const match = new RegExp(`(?:^|[,\\s])${name}=(\\d+)`).exec(header ?? '');
        return match?.[1] === undefined ? undefined : Number(match[1]);
    };
    return {
        maxAge: seconds('max-age') ?? 0,
        sMaxAge: seconds('s-maxage'),
        staleWhileRevalidate: seconds('stale-while-revalidate') ?? 0,
    };
};

/** An answer as a cache keeps it; `via` says which layer served it and how, `age` is the `Age` header in seconds. */
export type CachedAnswer = { etag: string | null; cacheControl: string | null; body: string; via: string; age: number };

/** Asks the next layer; `etag` is what this layer holds, so the origin can answer 304. */
export type Upstream = (etag: string | null) => Promise<CachedAnswer>;

/**
 * One HTTP cache of the path to the origin: serves a fresh entry, serves a stale one within stale-while-revalidate and
 * refreshes it in the background, and otherwise waits for `upstream`. `lifetime` picks the header's value this layer
 * obeys: a shared cache prefers `s-maxage`, a browser only reads `max-age`.
 */
export const createCacheLayer = ({
    name,
    lifetime,
    upstream,
    now = Date.now,
}: {
    name: string;
    lifetime: (freshness: Freshness) => number;
    upstream: Upstream;
    now?: () => number;
}) => {
    let entry: { answer: CachedAnswer; storedAt: number } | undefined;
    let refreshing: Promise<CachedAnswer> | undefined;

    const refresh = (): Promise<CachedAnswer> => {
        refreshing ??= upstream(entry?.answer.etag ?? null)
            .then((answer) => {
                entry = { answer, storedAt: now() - answer.age * 1000 };
                return answer;
            })
            .finally(() => {
                refreshing = undefined;
            });
        return refreshing;
    };

    return {
        get: async (): Promise<CachedAnswer> => {
            if (entry !== undefined) {
                const freshness = parseCacheControl(entry.answer.cacheControl);
                const age = (now() - entry.storedAt) / 1000;
                const fresh = lifetime(freshness);
                if (age < fresh) return { ...entry.answer, via: `${name}-fresh`, age };
                if (age < fresh + freshness.staleWhileRevalidate) {
                    refresh().catch(() => undefined);
                    return { ...entry.answer, via: `${name}-stale`, age };
                }
            }
            return refresh();
        },
    };
};

/** Asks the API with `If-None-Match`; a 304 gives back the last body, the only one the caller can hold. */
const originUpstream = (url: string, onAnswer: (answer: CachedAnswer) => void): Upstream => {
    let lastBody = '';
    return async (etag) => {
        const response = await fetch(url, { headers: etag === null ? {} : { 'If-None-Match': etag } });
        const cache = response.headers.get('x-cache') ?? '?';
        if (response.status !== 304) lastBody = await response.text();
        const answer = {
            etag: response.headers.get('etag') ?? etag,
            cacheControl: response.headers.get('cache-control'),
            body: lastBody,
            via: `origin-${response.status}-${cache}`,
            age: 0,
        };
        onAnswer(answer);
        return answer;
    };
};

const timelineSchema = z.object({
    items: z.array(
        z.object({
            transaction_hash: z.string(),
            chain_id: z.number(),
            price: z.object({ flag: z.string(), share_to_usd: z.number(), source: z.string() }),
        })
    ),
});

/** The price of `tx` in an API answer: undefined when the answer does not hold it. */
export const priceInAnswer = (body: string, chainId: number, tx: string) => {
    const parsed = timelineSchema.safeParse(parseJson(body));
    if (!parsed.success) return undefined;
    return parsed.data.items.find((item) => item.chain_id === chainId && item.transaction_hash === tx)?.price;
};

const eventRow = z.object({
    id: z.string(),
    trx_hash: z.string(),
    block_ms: z.coerce.number(),
    checkpoint: z.coerce.bigint(),
    head_price: z.number().nullable(),
    head_price_ms: z.coerce.number().nullable(),
});
const storedRow = z.object({
    event_id: z.string(),
    price_flag: z.string(),
    price_source: z.string(),
    share_to_usd: z.number(),
});
const frontierRow = z.object({ checkpoint: z.coerce.bigint() });
const watermarkRow = z.object({ watermark_ms: z.coerce.number() });

type Target = { chainId: number; account: string; version: number; envioDatabase: string; database: string };

const eventsStatement = ({ chainId, account, envioDatabase }: Target, tx: string | undefined): Sql => sql`
SELECT id, trx_hash, toUnixTimestamp64Milli(block_timestamp) AS block_ms, toString(envio_checkpoint_id) AS checkpoint,
    head_price, toUnixTimestamp64Milli(head_price_at) AS head_price_ms
FROM ${qualified(envioDatabase, timelineEventHistoryTable())}
WHERE account = ${param('String', account)} AND chain_id = ${param('Int32', chainId)} AND envio_change = 'SET'
    ${tx === undefined ? sql`` : sql`AND trx_hash = ${param('String', tx)}`}`;

const storedStatement = ({ chainId, account, version, database }: Target, eventId: string): Sql => sql`
SELECT event_id, toString(price_flag) AS price_flag, price_source, share_to_usd
FROM ${qualified(database, eventPriceTable(version))} FINAL
WHERE account = ${param('String', account)} AND chain_id = ${param('UInt32', chainId)}
    AND event_id = ${param('String', eventId)}`;

const frontierStatement = ({ chainId, envioDatabase }: Target): Sql => sql`
SELECT toString(checkpoint_id) AS checkpoint FROM ${qualified(envioDatabase, envioChainsTable())} FINAL
WHERE chain_id = ${param('Int32', chainId)}`;

const watermarkStatement = ({ version, database }: Target): Sql => sql`
SELECT toUnixTimestamp64Milli(watermark) AS watermark_ms FROM ${qualified(database, priceWatermarkTable(version))} FINAL`;

type Options = Target & {
    api: string;
    tx: string | undefined;
    refreshSeconds: number;
    pollSeconds: number;
    out: string | undefined;
    maxHours: number;
};

const parseOptions = (argv: string[]): Options => {
    const parsed = new Command('watch-timeline')
        .description('time one transaction from the chain to the API')
        .requiredOption('--chain <id>', 'chain id', chainIdArg)
        .requiredOption('--account <address>', "the user's address")
        .requiredOption('--version <n>', 'the deployment version', integerArg({ min: 1, max: 9999 }))
        .requiredOption('--envio-database <name>', "the version's Envio database", identifierArg)
        .option('--database <name>', 'the timeline database', identifierArg, 'beefy_indexer_dev_mrt')
        .option('--api <url>', 'the API', httpUrlArg, 'http://localhost:18431')
        .option('--tx <hash>', 'the transaction, when it is already known')
        .option('--refresh <seconds>', 'how often the simulated user refreshes', integerArg({ min: 1, max: 3600 }), 30)
        .option('--poll <seconds>', 'how often ClickHouse is read', integerArg({ min: 1, max: 600 }), 2)
        .option('--out <file>', 'append every step to this file as JSON lines')
        .option('--max-hours <n>', 'give up after this long', integerArg({ min: 1, max: 24 * 30 }), 30)
        .parse(argv, { from: 'user' })
        .opts<{
            chain: number;
            account: string;
            version: number;
            envioDatabase: string;
            database: string;
            api: string;
            tx?: string;
            refresh: number;
            poll: number;
            out?: string;
            maxHours: number;
        }>();
    return {
        chainId: parsed.chain,
        account: parsed.account.toLowerCase(),
        version: parsed.version,
        envioDatabase: parsed.envioDatabase,
        database: parsed.database,
        api: parsed.api,
        tx: parsed.tx?.toLowerCase(),
        refreshSeconds: parsed.refresh,
        pollSeconds: parsed.poll,
        out: parsed.out,
        maxHours: parsed.maxHours,
    };
};

const clickhouseFromEnv = (): ClickHouseClient => {
    // oxlint-disable-next-line no-process-env -- a one-off tool reading the worker's environment file
    const { CLICKHOUSE_URL: url, CLICKHOUSE_USERNAME: username, CLICKHOUSE_PASSWORD: password } = process.env;
    if (url === undefined || username === undefined || password === undefined) {
        throw new Error('CLICKHOUSE_URL, CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD are required');
    }
    return createClickHouseClient({ url, username, password, database: 'default' });
};

const main = async (): Promise<void> => {
    const options = parseOptions(process.argv.slice(2));
    const client = clickhouseFromEnv();
    const startedAt = Date.now();
    const known = new Set(R.map(await client.query(eventsStatement(options, undefined), eventRow), (row) => row.id));
    let blockMs: number | undefined;
    let tx = options.tx;
    /** When each step happened, in the order they did. */
    const steps = new Map<string, number>();
    const secondsAfterBlock = (at: number) => (blockMs === undefined ? '?' : ((at - blockMs) / 1000).toFixed(1));
    const finalFlags: readonly string[] = finalPriceFlags();

    const record = (step: string, detail?: unknown): void => {
        if (steps.has(step)) return;
        const at = Date.now();
        steps.set(step, at);
        const afterBlock = blockMs === undefined ? '' : `${secondsAfterBlock(at)}s after the block`;
        process.stdout.write(`${new Date(at).toISOString()} ${step} ${afterBlock} ${JSON.stringify(detail) ?? ''}\n`);
        if (options.out !== undefined) {
            appendFileSync(options.out, `${JSON.stringify({ step, at, blockMs, detail })}\n`);
        }
    };

    const url = `${options.api}/v1/users/${options.account}/timeline`;
    const noticePrice = (layer: string, answer: CachedAnswer): void => {
        if (tx === undefined) return;
        const price = priceInAnswer(answer.body, options.chainId, tx);
        if (price === undefined) return;
        record(`${layer}:visible`, { via: answer.via });
        record(`${layer}:flag:${price.flag}`, { ...price, via: answer.via });
    };
    const origin = originUpstream(url, (answer) => noticePrice('origin', answer));
    const edge = createCacheLayer({
        name: 'edge',
        lifetime: ({ maxAge, sMaxAge }) => sMaxAge ?? maxAge,
        upstream: origin,
    });
    const browser = createCacheLayer({ name: 'browser', lifetime: ({ maxAge }) => maxAge, upstream: () => edge.get() });

    const summary = (): void => {
        process.stdout.write('\nstep | seconds after the block\n');
        for (const [step, at] of steps) process.stdout.write(`${step} | ${secondsAfterBlock(at)}\n`);
    };
    process.on('SIGINT', () => {
        summary();
        process.exit(130);
    });

    const pollClickhouse = async (): Promise<boolean> => {
        const rows = await client.query(eventsStatement(options, tx), eventRow);
        const fresh = R.filter(rows, (row) => tx !== undefined || !known.has(row.id));
        const event = R.firstBy(fresh, (row) => row.block_ms);
        if (event === undefined) return false;
        tx ??= event.trx_hash;
        blockMs ??= event.block_ms;
        record('indexed', {
            tx,
            events: fresh.length,
            headPrice: event.head_price,
            headPriceAgeSeconds:
                event.head_price_ms === null ? null : Math.round((event.block_ms - event.head_price_ms) / 1000),
        });
        const [[frontier], [stored], [watermark]] = await Promise.all([
            client.query(frontierStatement(options), frontierRow),
            client.query(storedStatement(options, event.id), storedRow),
            client.query(watermarkStatement(options), watermarkRow),
        ]);
        if (frontier !== undefined && event.checkpoint <= frontier.checkpoint) record('committed');
        if (stored !== undefined) record(`stored:${stored.price_flag}`, stored);
        const passed = watermark !== undefined && watermark.watermark_ms > event.block_ms;
        if (passed) record('watermark');
        return passed && stored !== undefined && finalFlags.includes(stored.price_flag);
    };

    process.stdout.write(`watching ${url}: ${known.size} events known, send the transaction now\n`);
    let lastRefresh = 0;
    for (;;) {
        const final = await pollClickhouse().catch((error: unknown) => {
            process.stdout.write(`clickhouse: ${describeError(error)}\n`);
            return false;
        });
        if (Date.now() - lastRefresh >= options.refreshSeconds * 1000) {
            lastRefresh = Date.now();
            const answer = await browser.get().catch((error: unknown) => {
                process.stdout.write(`api: ${describeError(error)}\n`);
                return undefined;
            });
            if (answer !== undefined) noticePrice('user', answer);
        }
        const userSawFinal = finalFlags.some((flag) => steps.has(`user:flag:${flag}`));
        if ((final && userSawFinal) || Date.now() - startedAt > options.maxHours * 3_600_000) break;
        await sleep(options.pollSeconds * 1000);
    }
    summary();
};

if (import.meta.main) {
    main().catch((error: unknown) => {
        process.stderr.write(`${describeError(error)}\n`);
        process.exit(1);
    });
}
