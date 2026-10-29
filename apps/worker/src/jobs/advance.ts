import type { AdvanceResult } from '@beefy/clickhouse';

import { log } from '../lib/log.ts';
import type { Job } from './job.ts';

/**
 * Moves the price watermark of every version not dropped (`advance` in @beefy/clickhouse): the events it passes get
 * their final prices stored, and the recent events the indexer did not price get provisional rows. Safe to interrupt: the
 * watermark is written after each chunk, and the next run continues from there. A statement cannot be stopped midway,
 * so a shutdown either waits for it or kills the process, which loses nothing but that chunk. A rewind while it runs
 * stops it (`superseded`): the rewind is kept, the next run starts from it.
 */
const WAITING_REASONS = {
    'no-envio-database': 'the Envio database does not exist yet',
    'no-events': 'Envio has committed no event yet',
} as const;

export const advanceJob = ({
    intervalMinutes,
    advance,
}: {
    intervalMinutes: number;
    advance: () => Promise<AdvanceResult[]>;
}): Job => ({
    name: 'advance',
    intervalMs: intervalMinutes * 60_000,
    run: async () => {
        for (const { version, waiting, unsupported, superseded, from, to, statements } of await advance()) {
            if (unsupported !== undefined) {
                // a version this code cannot price nor serve (indexed before the indexer prices): retire it
                log.warn({ event: 'version-unsupported', version, reason: unsupported });
            } else if (waiting !== undefined) {
                log.info({ event: 'watermark-waiting', version, reason: WAITING_REASONS[waiting] });
            } else if (superseded === true) {
                log.info({ event: 'watermark-superseded', version, from, to, statements, reason: 'rewound meanwhile' });
            } else {
                log.info({ event: 'watermark-advanced', version, from, to, statements });
            }
        }
    },
});
