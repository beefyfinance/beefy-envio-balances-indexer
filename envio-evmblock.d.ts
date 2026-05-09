import type { EvmEvent } from 'envio';

declare module 'envio' {
    /** Aligns with `EvmBlock` in `.envio/types.d.ts` (not re-exported by codegen). */
    export type EvmBlock = EvmEvent<'ClassicVault', 'Initialized'>['block'];
}
