/**
 * Helpers for `createTestIndexer` simulate tests.
 *
 * Items that reach no handler fail the run, so dynamic contracts must be registered first with a factory event.
 * Do not put test-only addresses in config.yaml.
 */

import type { TimelineEvent } from 'envio';

type ProcessResult = { changes: ReadonlyArray<Record<string, unknown>> };

/** Every row `set` for `entity` across the processed blocks, in processing order. */
export const rowsOf = <T = Record<string, unknown>>(result: ProcessResult, entity: string): T[] =>
    result.changes.flatMap((change) => (change[entity] as { sets?: T[] } | undefined)?.sets ?? []);

/**
 * BALANCE `TimelineEvent` rows (the running balance step function) in processing order: `contract` is the share token
 * (or the boost), `sharesAfter` the account's balance after the change.
 */
export const balanceRowsOf = (result: ProcessResult) =>
    rowsOf<TimelineEvent>(result, 'TimelineEvent').filter(({ kind }) => kind === 'BALANCE');

/** Latest `set` per id for `entity` (current state after the run). */
export const latestById = <T extends { id: string }>(result: ProcessResult, entity: string): Map<string, T> =>
    new Map(rowsOf<T>(result, entity).map((row) => [row.id, row]));

/** Contract registrations (`contractRegister` → `chain.<Contract>.add`). */
export const registrationsOf = (result: ProcessResult) =>
    result.changes.flatMap(
        (change) =>
            (change.addresses as { sets?: Array<{ address: string; contract: string }> } | undefined)?.sets ?? []
    );

export const ZERO = '0x0000000000000000000000000000000000000000' as const;
export const USER_A = '0x94b32bdb9ff47f3239f04514bce862c7d95600ca' as const;
export const USER_B = '0x515e02402b7a3f67551763206d12cbde2d98766f' as const;
export const USER_C = '0x6f19da51d488926c007b9ebaa5968291a2ec6a62' as const;
export const EOA = '0x1111111111111111111111111111111111111111' as const;

/** 32-byte fake transaction hash built from a short tag (`hash(1)` → 0x00…01). */
export const hash = (tag: number) => `0x${tag.toString(16).padStart(64, '0')}` as const;

export const tx = (tag: number, from: `0x${string}` = EOA) => ({ hash: hash(tag), from });
