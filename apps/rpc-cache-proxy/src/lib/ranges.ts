/** An inclusive block range. */
export type Range = readonly [from: number, to: number];

/** The ranges of a Postgres multirange written as text (`{[1,5),[9,12)}`), as inclusive ranges. */
export const rangesOf = (text: string | null): Range[] =>
    text === null
        ? []
        : [...text.matchAll(/\[(\d+),(\d+)\)/g)].map((match) => [Number(match[1]), Number(match[2]) - 1]);

/** What of `from..to` the covered ranges leave out, in block order. */
export const gapsOf = (from: number, to: number, covered: readonly Range[]): Range[] => {
    const gaps: Range[] = [];
    let next = from;
    for (const [start, end] of [...covered].sort((a, b) => a[0] - b[0])) {
        if (start > next) gaps.push([next, Math.min(start - 1, to)]);
        next = Math.max(next, end + 1);
        if (next > to) break;
    }
    if (next <= to) gaps.push([next, to]);
    return gaps;
};
