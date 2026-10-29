import { msOf, timeOf, utcTime } from './sql.ts';

/** A time range `[from, to)` of block times (UTC `YYYY-MM-DD HH:MM:SS.fff`), open-ended without `to`. */
export type Range = { from: string; to?: string };

/** Events counted in `[startMs, startMs + bucket length)`. */
export type Bucket = { startMs: number; events: number };

/** A range a reprice statement covers, with the events counted in it (history rows: an upper bound). */
export type PlannedRange = Range & { events: number };

export type PlanLimits = {
    /** The most events one range should hold. A bucket with more is cut in equal parts of time (an estimate). */
    maxEvents: number;
    /** The longest a range may span from its first counted event to its last: it bounds the days of prices it reads. */
    maxSpanMs: number;
    /** The length of a bucket. */
    bucketMs: number;
};

type Atom = { startMs: number; endMs: number; events: number };

/** A bucket clipped to `[fromMs, toMs)` and cut in parts of at most `maxEvents` (assuming events spread evenly). */
const atomsOf = (bucket: Bucket, fromMs: number, toMs: number, { maxEvents, bucketMs }: PlanLimits): Atom[] => {
    const startMs = Math.max(bucket.startMs, fromMs);
    const endMs = Math.min(bucket.startMs + bucketMs, toMs);
    if (bucket.events <= 0 || endMs <= startMs) return [];
    const parts = Math.min(Math.ceil(bucket.events / maxEvents), endMs - startMs);
    return Array.from({ length: parts }, (_, index) => ({
        startMs: startMs + Math.floor((index * (endMs - startMs)) / parts),
        endMs: startMs + Math.floor(((index + 1) * (endMs - startMs)) / parts),
        events: Math.floor(((index + 1) * bucket.events) / parts) - Math.floor((index * bucket.events) / parts),
    }));
};

/**
 * Cuts `range` into consecutive ranges that cover it exactly, each holding at most `maxEvents` counted events (unless a
 * single part of a bucket holds more) and spanning at most `maxSpanMs` from its first counted event to its last, so a
 * reprice statement's memory depends on its chunk, not on the length of history. Time with no event is merged into the
 * range it borders: it costs nothing to price. A range with no event at all comes back once, with `events: 0`.
 */
export const planRanges = (range: Range, buckets: readonly Bucket[], limits: PlanLimits): PlannedRange[] => {
    const fromMs = msOf(range.from);
    const toMs = range.to === undefined ? Number.POSITIVE_INFINITY : msOf(range.to);
    const atoms = [...buckets]
        .sort((a, b) => a.startMs - b.startMs)
        .flatMap((bucket) => atomsOf(bucket, fromMs, toMs, limits));
    const planned: PlannedRange[] = [];
    let start = utcTime(range.from);
    let events = 0;
    let firstMs: number | undefined;
    for (const atom of atoms) {
        if (
            events > 0 &&
            (events + atom.events > limits.maxEvents ||
                (firstMs !== undefined && atom.endMs - firstMs > limits.maxSpanMs))
        ) {
            const cut = timeOf(atom.startMs);
            planned.push({ from: start, to: cut, events });
            start = cut;
            events = 0;
            firstMs = undefined;
        }
        events += atom.events;
        firstMs ??= atom.startMs;
    }
    planned.push({ from: start, ...(range.to === undefined ? {} : { to: utcTime(range.to) }), events });
    return planned;
};
