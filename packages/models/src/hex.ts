/** A `0x`-prefixed hex string (structurally identical to viem's `Hex`, without the dependency). */
export type Hex = `0x${string}`;

/**
 * Addresses and hashes are lowercase `0x` hex strings everywhere (schema, ids, effect inputs).
 * `address_format: lowercase` already lowercases event addresses; this normalises config values and RPC results.
 */
export const asHex = (hex: string): Hex => hex.toLowerCase() as Hex;

export const ZERO_ADDRESS: Hex = '0x0000000000000000000000000000000000000000';

export const isZeroAddress = (address: string): boolean => asHex(address) === ZERO_ADDRESS;

/** Undefined for a missing / zero address (a reverted or unset on-chain link). */
export const nonZeroAddress = (address: string | undefined): Hex | undefined =>
    address === undefined || isZeroAddress(address) ? undefined : asHex(address);
