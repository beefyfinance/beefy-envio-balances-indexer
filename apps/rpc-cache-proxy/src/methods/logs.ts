import * as R from 'remeda';

import { type Context, type Handler } from '../context.ts';
import { hex, num, quantity, sha, to0x } from '../lib/encoding.ts';
import { gapsOf, type Range, rangesOf } from '../lib/ranges.ts';
import { cleanLog, filterSchema, logsResult, resultOf, type RpcLog } from '../lib/rpc.ts';

type StoredLog = {
    block_number: string;
    log_index: number;
    block_hash: Buffer;
    tx_hash: Buffer;
    tx_index: number;
    address: Buffer;
    topic0: Buffer | null;
    topic1: Buffer | null;
    topic2: Buffer | null;
    topic3: Buffer | null;
    data: Buffer;
};

const rowToLog = (row: StoredLog): RpcLog & { removed: false } => ({
    address: to0x(row.address) ?? '',
    topics: [row.topic0, row.topic1, row.topic2, row.topic3]
        .filter((topic) => topic !== null)
        .map((topic) => to0x(topic) ?? ''),
    data: to0x(row.data) ?? '',
    blockNumber: quantity(Number(row.block_number)),
    transactionHash: to0x(row.tx_hash) ?? '',
    transactionIndex: quantity(row.tx_index),
    blockHash: to0x(row.block_hash) ?? '',
    logIndex: quantity(row.log_index),
    removed: false,
});

const lowercased = (values: readonly (string | null)[]): string[] =>
    values.filter((value): value is string => value !== null && value !== '').map((value) => value.toLowerCase());

/**
 * `eth_getLogs` for an address list and one topic0 list (nothing on the other topics): the part of the range the
 * cache knows complete is answered from Postgres, the gaps go to the node and are recorded. Final coverage is kept per
 * (address, topic0); near the head only the exact filter is covered, up to its last log, and only while that log's
 * block is still canonical.
 */
export const createLogsHandler = ({ config, read: sql, upstream, recorder, stats, head }: Context): Handler => {
    const s = stats.method('eth_getLogs');
    const { chainId, reorgDepth } = config;

    // a tip checked a moment ago is not checked again
    const tipChecks = new Map<string, boolean>();
    const tipIsCanonical = async (number: number, hash: string): Promise<boolean> => {
        const key = `${number}:${hash}`;
        const known = tipChecks.get(key);
        if (known !== undefined) return known;
        const answer = await upstream.call('eth_getBlockByNumber', [quantity(number), false], 'tip-check');
        const block = resultOf(answer.text);
        const canonical =
            typeof block === 'object' &&
            block !== null &&
            'hash' in block &&
            typeof block.hash === 'string' &&
            block.hash.toLowerCase() === `0x${hash}`;
        tipChecks.set(key, canonical);
        setTimeout(() => tipChecks.delete(key), 5_000).unref();
        return canonical;
    };

    return async (id, params) => {
        const parsed = filterSchema.safeParse(params[0] ?? {});
        const filter = parsed.success ? parsed.data : undefined;
        const rawTopics = filter?.topics ?? [];
        const first = rawTopics[0];
        const topics = lowercased([first ?? null].flat());
        const addresses = lowercased([filter?.address ?? null].flat());
        const usable =
            config.cache &&
            filter !== undefined &&
            filter.blockHash === undefined &&
            filter.fromBlock?.startsWith('0x') === true &&
            filter.toBlock?.startsWith('0x') === true &&
            addresses.length > 0 &&
            topics.length > 0 &&
            rawTopics.slice(1).every((topic) => topic === null);
        if (!usable || filter?.fromBlock === undefined || filter.toBlock === undefined) {
            s.uncacheable++;
            return upstream.call('eth_getLogs', params);
        }
        const from = num(filter.fromBlock);
        const to = num(filter.toBlock);
        const filterHash = sha(JSON.stringify([[...addresses].sort(), [...topics].sort()]));
        const a = JSON.stringify(addresses.map(hex));
        const t = JSON.stringify(topics.map(hex));
        const end = to + 1;
        const started = performance.now();
        let covered: Range[] = [];
        let tips: string[] = [];
        if (config.serve.has('logs')) {
            const [row] = await sql<{ n: number; cov: string | null }[]>`
                WITH a AS (SELECT array_agg(decode(x, 'hex')) v FROM json_array_elements_text(${a}::text::json) x),
                     t AS (SELECT array_agg(decode(x, 'hex')) v FROM json_array_elements_text(${t}::text::json) x)
                SELECT count(*)::int n, (range_intersect_agg(final) * int8multirange(int8range(${from}::bigint, ${end}::bigint)))::text cov
                FROM log_coverage, a, t
                WHERE chain_id = ${chainId} AND address = ANY(a.v) AND topic0 = ANY(t.v)`;
            // every (address, topic0) pair must have a row, or something is uncovered
            if (row !== undefined && row.n === addresses.length * topics.length) covered = rangesOf(row.cov);
            if (head.value() > 0 && to > head.value() - reorgDepth) {
                const near = await sql<{ r: string; tip_number: string; h: string }[]>`
                    SELECT blocks::text r, tip_number, encode(tip_hash, 'hex') h FROM log_tentative
                    WHERE chain_id = ${chainId} AND filter_hash = decode(${filterHash}, 'hex') AND blocks && int8range(${from}::bigint, ${end}::bigint)`;
                const checks = await Promise.all(near.map((row) => tipIsCanonical(Number(row.tip_number), row.h)));
                // one stale tip and the near-head rows cannot be told apart: ask the node for all of it
                if (checks.every(Boolean)) {
                    covered = [...covered, ...near.flatMap((row) => rangesOf(row.r))];
                    tips = near.map((row) => row.h);
                }
            }
        }
        const gaps = gapsOf(from, to, covered);
        const wholeRangeMissing = gaps.length === 1 && gaps[0]?.[0] === from && gaps[0][1] === to;
        const rows = wholeRangeMissing
            ? []
            : await sql<StoredLog[]>`
                WITH a AS (SELECT array_agg(decode(x, 'hex')) v FROM json_array_elements_text(${a}::text::json) x),
                     t AS (SELECT array_agg(decode(x, 'hex')) v FROM json_array_elements_text(${t}::text::json) x),
                     v AS (SELECT array_agg(decode(x, 'hex')) v FROM json_array_elements_text(${JSON.stringify(tips)}::text::json) x)
                SELECT block_number, log_index, block_hash, tx_hash, tx_index, logs.address, logs.topic0, topic1, topic2, topic3, data
                FROM logs, a, t, v
                WHERE chain_id = ${chainId} AND block_number >= ${from} AND block_number <= ${to}
                  AND logs.address = ANY(a.v) AND logs.topic0 = ANY(t.v) AND (final OR tip_hash = ANY(v.v))`;
        stats.lookup(s, performance.now() - started);
        if (gaps.length === 0) s.hit++;
        else if (wholeRangeMissing) s.miss++;
        else s.partial++;
        const covers = (block: number): boolean => !gaps.some(([start, end]) => block >= start && block <= end);
        const served = rows.map(rowToLog).filter((entry) => covers(num(entry.blockNumber)));
        s.servedRows += served.length;
        const fetched: RpcLog[] = [];
        for (const [gapFrom, gapTo] of gaps) {
            const answer = await upstream.call('eth_getLogs', [
                { ...filter, fromBlock: quantity(gapFrom), toBlock: quantity(gapTo) },
            ]);
            const result = logsResult.safeParse(resultOf(answer.text));
            if (!result.success) return answer; // the client knows what to do with a refusal
            recorder.recordLogs(addresses, topics, gapFrom, gapTo, result.data, filterHash);
            fetched.push(...result.data.map(cleanLog));
        }
        const logs = R.sortBy(
            [...served, ...fetched],
            (entry) => num(entry.blockNumber),
            (entry) => num(entry.logIndex)
        );
        return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', id, result: logs }) };
    };
};
