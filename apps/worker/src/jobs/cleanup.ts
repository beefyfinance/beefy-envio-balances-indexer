import type { CleanupReport } from '@beefy/clickhouse';

import { log } from '../lib/log.ts';
import type { Job } from './job.ts';

/**
 * Drops the versions retired for longer than the grace period (`cleanup` in @beefy/clickhouse): their tables, then
 * their Envio database. Every step is recorded and rerunnable. Databases and tables that look like a version's but
 * belong to no live one are only reported, as warnings: an operator decides, nothing unknown is ever dropped. So are
 * the versions kept because a view still names them, and the Envio databases it refused to drop (a registered name that
 * is not `<prefix><N>`, or a protected database).
 */
export const cleanupJob = ({
    intervalHours,
    cleanup,
}: {
    intervalHours: number;
    cleanup: () => Promise<CleanupReport>;
}): Job => ({
    name: 'cleanup',
    intervalMs: intervalHours * 3_600_000,
    run: async () => {
        const { dropped, inUse, refused, unknownDatabases, unknownTables } = await cleanup();
        for (const step of dropped) log.info({ event: 'version-dropped', step });
        for (const version of inUse) {
            log.warn({
                event: 'version-in-use',
                version,
                action: 'kept: a view still names it (a switch in progress or interrupted?)',
            });
        }
        for (const database of refused) {
            log.warn({ event: 'drop-refused', database, action: 'none: fix the deployments row or drop it by hand' });
        }
        for (const database of unknownDatabases) {
            log.warn({ event: 'unknown-database', database, action: 'none: drop it by hand if it is not used' });
        }
        for (const table of unknownTables) {
            log.warn({ event: 'unknown-table', table, action: 'none: drop it by hand if it is not used' });
        }
    },
});
