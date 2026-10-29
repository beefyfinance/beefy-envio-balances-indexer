import { vi } from 'vitest';

import { log } from './log.ts';

export type CapturedLine = { event: string; level?: 'warn' | 'error' } & Record<string, unknown>;

/** Tests: what goes to {@link log} from now on, each line's fields with its level (none for info), nothing written. */
export const captureLog = (): CapturedLine[] => {
    const lines: CapturedLine[] = [];
    vi.spyOn(log, 'info').mockImplementation(((fields: CapturedLine) => void lines.push({ ...fields })) as never);
    for (const level of ['warn', 'error'] as const) {
        vi.spyOn(log, level).mockImplementation(
            ((fields: CapturedLine) => void lines.push({ ...fields, level })) as never
        );
    }
    return lines;
};
