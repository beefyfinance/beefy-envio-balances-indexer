import type { VersionStatus } from '@beefy/clickhouse';

import { log } from '../lib/log.ts';
import type { Job } from './job.ts';

/** One line of {@link versionReport}; `level: 'warn'` marks what should alert. */
export type ReportLine = { event: string; level?: 'info' | 'warn' } & Record<string, unknown>;

export type VersionThresholds = {
    /** A watermark older than this: a price source or the advance job stopped. */
    watermarkAlertSeconds: number;
    /**
     * The active version: warn when more than this share (0 to 1) of the last hour's events has no indexer price (the
     * indexer's price cache stopped, or the Beefy API is down).
     */
    unpricedShareAlert: number;
    /** A version still `building` this long after its deploy: Envio stalled, or it was forgotten. */
    buildingAlertHours: number;
};

/**
 * What to say about the versions not dropped: one info line each, and a warning for an old watermark, a version stuck
 * in `building`, and no active version at all (the API then has nothing to read). A version with no watermark yet (its
 * first advance has not run) is pending, not late: it is said in its line (`watermark: null`) and warned about only
 * when it is outside `building` and has been deployed for longer than the watermark alert (the advance job is not running
 * for it); a building one is the stuck check's job. For the active version, it also says how its recent events are
 * priced, and warns when too many of the last hour's have no indexer price, or when any event older than the alert age is
 * `PENDING` (the advance does not write provisional rows).
 */
export const versionReport = (
    statuses: readonly VersionStatus[],
    { watermarkAlertSeconds, unpricedShareAlert, buildingAlertHours }: VersionThresholds,
    now: number
): ReportLine[] => {
    const lines: ReportLine[] = [];
    for (const status of statuses) {
        const { version, state, envioDatabase, createdAt, watermark, watermarkAgeSeconds, headPrices } = status;
        const ageSeconds = (now - Date.parse(`${createdAt.replace(' ', 'T')}Z`)) / 1000;
        lines.push({
            event: 'version-status',
            version,
            state,
            envioDatabase,
            watermark,
            watermarkAgeSeconds,
            ...(headPrices === null ? {} : headPrices),
        });
        if (headPrices !== null) {
            const { lastHourEvents, lastHourUnpriced, lastHourUnpricedShare, pendingOld } = headPrices;
            if (lastHourUnpricedShare !== null && lastHourUnpricedShare > unpricedShareAlert) {
                lines.push({
                    event: 'indexer-prices-missing',
                    level: 'warn',
                    version,
                    lastHourEvents,
                    lastHourUnpriced,
                    lastHourUnpricedShare,
                });
            }
            if (pendingOld > 0) lines.push({ event: 'pending-events-old', level: 'warn', version, pendingOld });
        }
        if (watermarkAgeSeconds !== null && watermarkAgeSeconds > watermarkAlertSeconds) {
            lines.push({ event: 'watermark-old', level: 'warn', version, state, watermark, watermarkAgeSeconds });
        }
        if (watermarkAgeSeconds === null && state !== 'building' && ageSeconds > watermarkAlertSeconds) {
            lines.push({ event: 'watermark-missing', level: 'warn', version, state, createdAt });
        }
        if (state === 'building' && ageSeconds / 3600 > buildingAlertHours) {
            lines.push({
                event: 'version-stuck-building',
                level: 'warn',
                version,
                createdAt,
                buildingHours: Math.round(ageSeconds / 3600),
            });
        }
    }
    if (!statuses.some((status) => status.state === 'active')) {
        lines.push({ event: 'no-active-version', level: 'warn' });
    }
    return lines;
};

/** Logs {@link versionReport} on an interval: the warnings are what the log drain alerts on. */
export const versionStatusJob = ({
    intervalMinutes,
    thresholds,
    read,
    now = Date.now,
}: {
    intervalMinutes: number;
    thresholds: VersionThresholds;
    read: () => Promise<VersionStatus[]>;
    now?: () => number;
}): Job => ({
    name: 'version-status',
    intervalMs: intervalMinutes * 60_000,
    run: async () => {
        for (const { level = 'info', ...line } of versionReport(await read(), thresholds, now())) log[level](line);
    },
});
