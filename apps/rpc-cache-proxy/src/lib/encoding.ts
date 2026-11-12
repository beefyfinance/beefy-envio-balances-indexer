import { createHash } from 'node:crypto';

/** `0xAB…` → `ab…`: how hashes, addresses and data are stored (bytea, written through `decode(…, 'hex')`). */
export const hex = (value: string): string => value.slice(2).toLowerCase();

/** A JSON-RPC quantity (`0x1f`) as a number. Block numbers, indexes and heights fit a double. */
export const num = (value: string): number => Number.parseInt(value, 16);

export const to0x = (buffer: Buffer | null): string | null => (buffer === null ? null : `0x${buffer.toString('hex')}`);

export const quantity = (value: number | bigint): string => `0x${BigInt(value).toString(16)}`;

export const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
