import * as R from 'remeda';

/** Durations in milliseconds: the exact count and total, the last `SAMPLE_LIMIT` for the percentiles. */
type Timing = { count: number; totalMs: number; samples: number[]; next: number };
const SAMPLE_LIMIT = 20_000;

const newTiming = (): Timing => ({ count: 0, totalMs: 0, samples: [], next: 0 });
const addSample = (timing: Timing, ms: number): void => {
    timing.count++;
    timing.totalMs += ms;
    if (timing.samples.length < SAMPLE_LIMIT) timing.samples.push(ms);
    else timing.samples[timing.next % SAMPLE_LIMIT] = ms;
    timing.next++;
};
const quantile = (timing: Timing, q: number): number | null => {
    if (timing.samples.length === 0) return null;
    const sorted = [...timing.samples].sort((a, b) => a - b);
    return Math.round((sorted[Math.floor(q * (sorted.length - 1))] ?? 0) * 100) / 100;
};

/** What happened to the requests of one JSON-RPC method. */
export type MethodStats = {
    requests: number;
    hit: number;
    partial: number;
    miss: number;
    uncacheable: number;
    /** Calls made to the upstream. */
    upstream: number;
    servedRows: number;
    lookup: Timing;
    upstreamTiming: Timing;
};

export type WriteStats = {
    flushes: number;
    flushMs: number;
    maxFlushMs: number;
    rows: number;
    pairs: number;
    peakQueue: number;
    dropped: number;
    failed: number;
    lastError: string;
};

export type Stats = {
    method: (name: string) => MethodStats;
    writes: WriteStats;
    lookup: (stats: MethodStats, ms: number) => void;
    upstreamCall: (stats: MethodStats, ms: number) => void;
    report: () => Record<string, unknown>;
};

export const createStats = (now: () => number = Date.now): Stats => {
    const methods = new Map<string, MethodStats>();
    const startedAt = now();
    const writes: WriteStats = {
        flushes: 0,
        flushMs: 0,
        maxFlushMs: 0,
        rows: 0,
        pairs: 0,
        peakQueue: 0,
        dropped: 0,
        failed: 0,
        lastError: '',
    };
    const method = (name: string): MethodStats => {
        const known = methods.get(name);
        if (known !== undefined) return known;
        const created: MethodStats = {
            requests: 0,
            hit: 0,
            partial: 0,
            miss: 0,
            uncacheable: 0,
            upstream: 0,
            servedRows: 0,
            lookup: newTiming(),
            upstreamTiming: newTiming(),
        };
        methods.set(name, created);
        return created;
    };
    return {
        method,
        writes,
        lookup: (stats, ms) => addSample(stats.lookup, ms),
        upstreamCall: (stats, ms) => {
            stats.upstream++;
            addSample(stats.upstreamTiming, ms);
        },
        report: () => ({
            seconds: Math.round((now() - startedAt) / 1000),
            methods: R.pipe(
                [...methods.entries()],
                R.map(
                    ([name, s]) =>
                        [
                            name,
                            {
                                requests: s.requests,
                                hit: s.hit,
                                partial: s.partial,
                                miss: s.miss,
                                uncacheable: s.uncacheable,
                                upstream: s.upstream,
                                servedRows: s.servedRows,
                                lookups: s.lookup.count,
                                lookupP50: quantile(s.lookup, 0.5),
                                lookupP99: quantile(s.lookup, 0.99),
                                lookupTotalS: Math.round(s.lookup.totalMs) / 1000,
                                upstreamP50: quantile(s.upstreamTiming, 0.5),
                                upstreamTotalS: Math.round(s.upstreamTiming.totalMs) / 1000,
                            },
                        ] as const
                ),
                R.fromEntries()
            ),
            writes,
        }),
    };
};
