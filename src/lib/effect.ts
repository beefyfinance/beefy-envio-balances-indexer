import { type Bytes, type Hex, toBytes, toHex } from './hex';

const HEX_STRING_RE = /^0x[0-9a-fA-F]*$/;

type HexString = Hex;

/**
 * Maps effect-cache hex (`0x…` strings) to domain `Bytes`.
 * Envio caches effect IO as strings; callers still pass hex.
 */
export type ToDomain<T> = T extends Uint8Array
    ? T
    : T extends HexString
      ? Bytes
      : T extends readonly (infer U)[]
        ? ToDomain<U>[]
        : T extends object
          ? { [K in keyof T]: ToDomain<T[K]> }
          : T;

export const decodeEffectValue = (value: unknown): unknown => {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (typeof value === 'string' && HEX_STRING_RE.test(value)) {
        return toBytes(value);
    }
    if (Array.isArray(value)) {
        return value.map(decodeEffectValue);
    }
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, decodeEffectValue(nested)])
        );
    }
    return value;
};

export const encodeEffectValue = (value: unknown): unknown => {
    if (value instanceof Uint8Array) {
        return toHex(value);
    }
    if (Array.isArray(value)) {
        return value.map(encodeEffectValue);
    }
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, encodeEffectValue(nested)])
        );
    }
    return value;
};

/** Decode Envio effect input (hex cache) into domain Bytes. */
export const decodeEffectInput = <T>(input: T): ToDomain<T> => decodeEffectValue(input) as ToDomain<T>;

/** Encode domain Bytes back to hex for Envio effect output/cache. */
export const encodeEffectOutput = <T>(output: ToDomain<T> | T): T => encodeEffectValue(output) as T;
