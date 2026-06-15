/**
 * Splits an array of results from batch calls into separate arrays based on batch sizes.
 */
export function splitBatchResults<T extends unknown[]>(results: readonly unknown[], batchSizes: number[]): T[] {
    let startIndex = 0;
    const batches: T[] = [];

    for (const batchSize of batchSizes) {
        const endIndex = startIndex + batchSize;
        const batch = results.slice(startIndex, endIndex) as T;
        batches.push(batch);
        startIndex = endIndex;
    }

    return batches;
}

export function multiZip<A extends unknown[]>(a: A): Array<[A[number]]>;
export function multiZip<A extends unknown[], B extends unknown[]>(a: A, b: B): Array<[A[number], B[number]]>;
export function multiZip<A extends unknown[], B extends unknown[], C extends unknown[]>(
    a: A,
    b: B,
    c: C
): Array<[A[number], B[number], C[number]]>;
export function multiZip<A extends unknown[], B extends unknown[], C extends unknown[], D extends unknown[]>(
    a: A,
    b: B,
    c: C,
    d: D
): Array<[A[number], B[number], C[number], D[number]]>;
export function multiZip<T extends unknown[][]>(...arrays: T[]): unknown[][] {
    if (arrays.length === 0) return [];

    const length = Math.min(...arrays.map((arr) => arr.length));
    const result: unknown[][] = [];

    for (let i = 0; i < length; i++) {
        result.push(arrays.map((arr) => arr[i]));
    }

    return result;
}

export function zipSameLength<A, B>(a: readonly A[], b: readonly B[]): Array<[A, B]> {
    if (a.length !== b.length) {
        throw new Error(`zipSameLength: length mismatch (${a.length} vs ${b.length})`);
    }
    // biome-ignore lint/style/noNonNullAssertion: we checked the length above
    return a.map((item, i) => [item, b[i]!]);
}
