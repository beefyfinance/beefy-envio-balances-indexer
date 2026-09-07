import { bytesToHex } from 'viem';
import { expect } from 'vitest';

expect.addSnapshotSerializer({
    test: (value) => value instanceof Uint8Array,
    serialize: (value) => `"${bytesToHex(value as Uint8Array)}"`,
});
