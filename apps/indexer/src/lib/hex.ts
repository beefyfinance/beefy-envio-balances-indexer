import type { Hex } from 'viem';

export type { Hex };

/**
 * Addresses and hashes are lowercase `0x` hex strings everywhere (schema, ids, effect inputs).
 * `address_format: lowercase` already lowercases event addresses; this normalises config values and RPC results.
 */
export const asHex = (hex: string): Hex => hex.toLowerCase() as Hex;

const ZERO_ADDRESS: Hex = '0x0000000000000000000000000000000000000000';

export const isZeroAddress = (address: string): boolean => asHex(address) === ZERO_ADDRESS;

/** Undefined for a missing / zero address (a reverted or unset on-chain link). */
export const nonZeroAddress = (address: string | undefined): Hex | undefined =>
    address === undefined || isZeroAddress(address) ? undefined : asHex(address);
