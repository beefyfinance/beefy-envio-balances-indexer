import { describeError } from '@beefy/config';
import type { Sql } from 'postgres';

import type { Head } from './head.ts';
import { hex, num } from './lib/encoding.ts';
import { log } from './lib/log.ts';
import type { RpcLog } from './lib/rpc.ts';
import type { Stats } from './stats.ts';

type LogRow = {
    c: number;
    b: number;
    li: number;
    h: string;
    th: string;
    ti: number;
    a: string;
    t0: string | null;
    t1: string | null;
    t2: string | null;
    t3: string | null;
    d: string;
    f: boolean;
    tip: string | null;
};
type TentativeRow = { c: number; f: string; r: string; n: number; h: string };
type BlockRow = { c: number; n: number; full: boolean; h: string | null; f: boolean; raw: string };
type TransactionRow = { c: number; h: string; n: number | null; f: boolean; raw: string };
type CallRow = { c: number; k: string; n: number; f: boolean; r: string };

export type Recorder = {
    recordLogs: (
        addresses: readonly string[],
        topics: readonly string[],
        from: number,
        to: number,
        logs: readonly RpcLog[],
        filterHash: string
    ) => void;
    recordBlock: (number: number, full: boolean, hash: string | null, raw: string) => void;
    recordTransaction: (hash: string, block: number | null, raw: string) => void;
    recordCall: (key: string, block: number, result: string) => void;
    /** Writes what is queued; a failed write is counted and logged, never thrown. */
    flush: () => Promise<void>;
    /** Flushes every `flushMilliseconds` until stopped. */
    start: () => void;
    stop: () => Promise<void>;
};

type Settings = { chainId: number; maxQueue: number; flushMilliseconds: number; reorgDepth: number };

/**
 * Everything the proxy sees goes into queues that a timer writes in batches: an answer never waits for a write, and
 * when the queues are full new rows are dropped (counted) rather than held back. Logs commit together with their
 * coverage, so coverage never promises rows that are not stored yet.
 */
export const createRecorder = (write: Sql, settings: Settings, head: Head, stats: Stats): Recorder => {
    const { chainId, maxQueue, flushMilliseconds, reorgDepth } = settings;
    let logs = new Map<string, LogRow>();
    let pairs = new Map<string, string[]>();
    let tentative: TentativeRow[] = [];
    let blocks = new Map<string, BlockRow>();
    let transactions = new Map<string, TransactionRow>();
    let calls = new Map<string, CallRow>();
    const queued = (): number =>
        logs.size + pairs.size + tentative.length + blocks.size + transactions.size + calls.size;
    const room = (): boolean => {
        const size = queued();
        stats.writes.peakQueue = Math.max(stats.writes.peakQueue, size);
        if (size < maxQueue) return true;
        stats.writes.dropped++;
        return false;
    };

    const recordLogs: Recorder['recordLogs'] = (addresses, topics, from, to, received, filterHash) => {
        if (!room()) return;
        const finalTo = Math.min(to, head.value() - reorgDepth);
        // above the final part, trust the range only up to the last log: its block hash is the tip that proves the rest
        const tip = received.filter((entry) => num(entry.blockNumber) > finalTo).at(-1);
        for (const entry of received) {
            const final = num(entry.blockNumber) <= finalTo;
            logs.set(`${entry.blockHash}:${entry.logIndex}`, {
                c: chainId,
                b: num(entry.blockNumber),
                li: num(entry.logIndex),
                h: hex(entry.blockHash),
                th: hex(entry.transactionHash),
                ti: num(entry.transactionIndex),
                a: hex(entry.address),
                t0: entry.topics[0] === undefined ? null : hex(entry.topics[0]),
                t1: entry.topics[1] === undefined ? null : hex(entry.topics[1]),
                t2: entry.topics[2] === undefined ? null : hex(entry.topics[2]),
                t3: entry.topics[3] === undefined ? null : hex(entry.topics[3]),
                d: hex(entry.data),
                f: final,
                tip: final || tip === undefined ? null : hex(tip.blockHash),
            });
        }
        if (finalTo >= from) {
            const range = `[${from},${finalTo + 1})`;
            for (const address of addresses)
                for (const topic of topics) {
                    const key = `${hex(address)}|${hex(topic)}`;
                    const ranges = pairs.get(key);
                    if (ranges === undefined) pairs.set(key, [range]);
                    else ranges.push(range);
                }
        }
        if (tip !== undefined)
            tentative.push({
                c: chainId,
                f: filterHash,
                r: `[${Math.max(from, finalTo + 1)},${num(tip.blockNumber) + 1})`,
                n: num(tip.blockNumber),
                h: hex(tip.blockHash),
            });
    };

    const flush = async (): Promise<void> => {
        if (queued() === 0) return;
        const batch = {
            logs: [...logs.values()],
            pairs: [...pairs.entries()].map(([key, ranges]) => {
                const [a, t] = key.split('|');
                return { c: chainId, a, t, r: `{${ranges.join(',')}}` };
            }),
            tentative,
            blocks: [...blocks.values()],
            transactions: [...transactions.values()],
            calls: [...calls.values()],
        };
        logs = new Map();
        pairs = new Map();
        tentative = [];
        blocks = new Map();
        transactions = new Map();
        calls = new Map();
        const started = performance.now();
        try {
            await write.begin(async (transaction) => {
                // postgres.js types a transaction without the tagged-template call signature it has at runtime
                const sql = transaction as unknown as Sql;
                if (batch.logs.length > 0)
                    await sql`
                        INSERT INTO logs
                        SELECT c, b, li, decode(h, 'hex'), decode(th, 'hex'), ti, decode(a, 'hex'), decode(t0, 'hex'), decode(t1, 'hex'),
                               decode(t2, 'hex'), decode(t3, 'hex'), decode(d, 'hex'), f, decode(tip, 'hex')
                        FROM json_to_recordset(${JSON.stringify(batch.logs)}::text::json)
                             AS x(c int, b bigint, li int, h text, th text, ti int, a text, t0 text, t1 text, t2 text, t3 text, d text, f bool, tip text)
                        ON CONFLICT (chain_id, block_hash, log_index) DO UPDATE SET final = logs.final OR EXCLUDED.final, tip_hash = EXCLUDED.tip_hash`;
                if (batch.pairs.length > 0)
                    await sql`
                        INSERT INTO log_coverage
                        SELECT c, decode(a, 'hex'), decode(t, 'hex'), r::int8multirange
                        FROM json_to_recordset(${JSON.stringify(batch.pairs)}::text::json) AS x(c int, a text, t text, r text)
                        ON CONFLICT (chain_id, address, topic0) DO UPDATE SET final = log_coverage.final + EXCLUDED.final`;
                if (batch.tentative.length > 0)
                    await sql`
                        INSERT INTO log_tentative
                        SELECT c, decode(f, 'hex'), r::int8range, n, decode(h, 'hex')
                        FROM json_to_recordset(${JSON.stringify(batch.tentative)}::text::json) AS x(c int, f text, r text, n bigint, h text)`;
                if (batch.blocks.length > 0)
                    await sql`
                        INSERT INTO blocks
                        SELECT c, n, x.full, decode(h, 'hex'), f, raw
                        FROM json_to_recordset(${JSON.stringify(batch.blocks)}::text::json) AS x(c int, n bigint, "full" bool, h text, f bool, raw text)
                        ON CONFLICT (chain_id, number, full_txs) DO UPDATE SET hash = EXCLUDED.hash, final = EXCLUDED.final, raw = EXCLUDED.raw`;
                if (batch.transactions.length > 0)
                    await sql`
                        INSERT INTO transactions
                        SELECT c, decode(h, 'hex'), n, f, raw
                        FROM json_to_recordset(${JSON.stringify(batch.transactions)}::text::json) AS x(c int, h text, n bigint, f bool, raw text)
                        ON CONFLICT (chain_id, hash) DO UPDATE SET block_number = EXCLUDED.block_number, final = EXCLUDED.final, raw = EXCLUDED.raw`;
                if (batch.calls.length > 0)
                    await sql`
                        INSERT INTO calls
                        SELECT c, decode(k, 'hex'), n, f, decode(r, 'hex')
                        FROM json_to_recordset(${JSON.stringify(batch.calls)}::text::json) AS x(c int, k text, n bigint, f bool, r text)
                        ON CONFLICT (chain_id, key) DO UPDATE SET final = EXCLUDED.final, result = EXCLUDED.result`;
            });
            const ms = performance.now() - started;
            const writes = stats.writes;
            writes.flushes++;
            writes.flushMs += ms;
            writes.maxFlushMs = Math.max(writes.maxFlushMs, ms);
            writes.rows += batch.logs.length + batch.blocks.length + batch.transactions.length + batch.calls.length;
            writes.pairs += batch.pairs.length;
        } catch (error) {
            stats.writes.failed++;
            stats.writes.lastError = describeError(error).slice(0, 200);
            log.warn(
                { event: 'flush-failed', error: stats.writes.lastError },
                'the cache write failed; its rows are lost'
            );
        }
    };

    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    let flushing: Promise<void> = Promise.resolve();
    const tick = (): void => {
        flushing = flush().finally(() => {
            if (!stopped) timer = setTimeout(tick, flushMilliseconds);
        });
    };

    return {
        recordLogs,
        recordBlock: (number, full, hash, raw) => {
            if (room())
                blocks.set(`${number}:${full}`, {
                    c: chainId,
                    n: number,
                    full,
                    h: hash === null ? null : hex(hash),
                    f: head.isFinal(number),
                    raw,
                });
        },
        recordTransaction: (hash, block, raw) => {
            if (room())
                transactions.set(hash, {
                    c: chainId,
                    h: hex(hash),
                    n: block,
                    f: block !== null && head.isFinal(block),
                    raw,
                });
        },
        recordCall: (key, block, result) => {
            if (room()) calls.set(key, { c: chainId, k: key, n: block, f: head.isFinal(block), r: hex(result) });
        },
        flush,
        start: () => tick(),
        stop: async () => {
            stopped = true;
            if (timer !== undefined) clearTimeout(timer);
            await flushing;
            await flush();
        },
    };
};
