import {
    type ClickhouseConfig,
    clickhousePipeline,
    ConfigError,
    type Env,
    integer,
    listOf,
    parseEnv,
    type RepriceConfig,
    repriceSettings,
} from '@beefy/config';

import { type JobName, jobNames } from '../jobs/index.ts';

/**
 * The worker's configuration, and the only place of the worker that reads `process.env` ({@link readConfig}).
 * Everything is parsed and checked at startup: a missing or invalid value stops the process before any job runs.
 */
export type WorkerConfig = {
    jobs: JobName[];
    clickhouse: ClickhouseConfig;
    /** How reprice statements are sized and limited, the retry window, the watermark's age, the cleanup grace period. */
    reprice: RepriceConfig;
    /** advance: minutes between the end of one run and the next. */
    advanceIntervalMinutes: number;
    /** cleanup: hours between runs. */
    cleanupIntervalHours: number;
    /** version-status: minutes between reports, and what it warns about. */
    statusIntervalMinutes: number;
    watermarkAlertSeconds: number;
    /** Percentage of the active version's last hour of events without an indexer price above which it warns. */
    unpricedAlertPercent: number;
    buildingAlertHours: number;
    /** `PENDING` events older than this mean the advance does not write provisional rows: it warns on any. */
    pendingAlertMinutes: number;
    /** On SIGTERM, how long a running job gets before the process exits anyway. */
    shutdownGraceSeconds: number;
};

export const loadConfig = (env: Env): WorkerConfig =>
    parseEnv(env, {
        jobs: listOf('WORKER_JOBS', jobNames(), jobNames()),
        clickhouse: clickhousePipeline(),
        reprice: repriceSettings(),
        // the watermark stays a day behind now, so every 15 minutes is plenty; each run only reprices what it passed
        advanceIntervalMinutes: integer('ADVANCE_INTERVAL_MINUTES', 15, { min: 1, max: 24 * 60 }),
        cleanupIntervalHours: integer('CLEANUP_INTERVAL_HOURS', 24, { min: 1, max: 24 * 7 }),
        statusIntervalMinutes: integer('VERSION_STATUS_INTERVAL_MINUTES', 5, { min: 1, max: 24 * 60 }),
        watermarkAlertSeconds: integer('WATERMARK_ALERT_SECONDS', 2 * 86_400, { min: 3600, max: 30 * 86_400 }),
        // some products are not listed by the Beefy API (provisional rows price them): only a large share is a stopped cache
        unpricedAlertPercent: integer('UNPRICED_ALERT_PERCENT', 50, { min: 0, max: 100 }),
        // a reindex of every chain takes days: warn only once it is clearly longer than one
        buildingAlertHours: integer('BUILDING_ALERT_HOURS', 7 * 24, { min: 1, max: 24 * 90 }),
        pendingAlertMinutes: integer('PENDING_ALERT_MINUTES', 30, { min: 1, max: 24 * 60 }),
        // Heroku gives a process 30 seconds after SIGTERM
        shutdownGraceSeconds: integer('SHUTDOWN_GRACE_SECONDS', 10, { min: 1, max: 30 }),
    });

/** {@link loadConfig} of the process environment; on a problem, says what is wrong and exits. */
export const readConfig = (): WorkerConfig => {
    try {
        return loadConfig(process.env);
    } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    }
};
