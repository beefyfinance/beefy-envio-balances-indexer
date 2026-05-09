import { S } from 'envio';
import type { Hex } from 'viem';

// todo: refine
export const hexSchema: S.Schema<Hex, string> = S.string;

export const normalizeHex = (value: Hex | string | { toString(): string }): Hex => {
    return String(value).toLowerCase() as Hex;
};
