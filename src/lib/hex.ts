import { S } from 'envio';
import { bytesToHex, type Hex, hexToBytes } from 'viem';

export type { Hex };

/**
 * Domain bytes for addresses, hashes, and schema `Bytes` fields.
 * Runtime value is `Uint8Array` (Envio `bytes_type: uint8array`); this alias
 * matches the GraphQL scalar name used in schema.graphql.
 */
export type Bytes = Uint8Array;

/** Decode a hex string (events, config, viem) into domain bytes. */
export const toBytes = (hex: string): Bytes => hexToBytes(hex.toLowerCase() as Hex);

/** Encode domain bytes to lowercase hex (ids, viem, contract registration, string fields). */
export const toHex = (bytes: Bytes): Hex => bytesToHex(bytes);

/** Lowercase an already-hex string. Prefer this over `toHex(toBytes(hex))`. */
export const asHex = (hex: string): Hex => hex.toLowerCase() as Hex;

export const ZERO_ADDRESS: Bytes = toBytes('0x0000000000000000000000000000000000000000');
export const ZERO_ADDRESS_HEX: Hex = toHex(ZERO_ADDRESS);
export const ZERO_HASH: Bytes = toBytes('0x0000000000000000000000000000000000000000000000000000000000000000');

export const bytesEqual = (a: Bytes, b: Bytes): boolean => {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
};

export const bytesIncludes = (values: readonly Bytes[], value: Bytes): boolean =>
    values.some((candidate) => bytesEqual(candidate, value));

export const isZeroAddress = (value: Bytes): boolean => bytesEqual(value, ZERO_ADDRESS);

/** Encoded as hex text (effect cache / config parse); domain is Bytes. */
export const bytesSchema: S.Schema<Bytes, string> = S.transform(S.string, toBytes, toHex);

/** Lowercase hex for Envio effect cache. Decode with `decodeEffectInput` in the handler. */
export const hexSchema: S.Schema<Hex, string> = S.transform(S.string, asHex, (value) => value);
