import { advance, type ClickhouseClient, cleanup, schemaFromConfig, versionStatuses } from '@beefy/clickhouse';

import type { WorkerConfig } from '../lib/config.ts';
import { advanceJob } from './advance.ts';
import { cleanupJob } from './cleanup.ts';
import type { Job } from './job.ts';
import { versionStatusJob } from './versionStatus.ts';

/** Every job the worker knows. Add the name here and a factory below; `WORKER_JOBS` picks which run in a process. */
const JOB_NAMES = ['advance', 'cleanup', 'version-status'] as const;
export type JobName = (typeof JOB_NAMES)[number];
export const jobNames = (): JobName[] => [...JOB_NAMES];

export type JobDeps = { client: ClickhouseClient };

const FACTORIES: Record<JobName, (config: WorkerConfig, deps: JobDeps) => Job> = {
    advance: (config, { client }) =>
        advanceJob({
            intervalMinutes: config.advanceIntervalMinutes,
            advance: () => advance(client, schemaFromConfig(config.clickhouse), config.reprice),
        }),
    cleanup: (config, { client }) =>
        cleanupJob({
            intervalHours: config.cleanupIntervalHours,
            cleanup: () =>
                cleanup(client, schemaFromConfig(config.clickhouse), { graceHours: config.reprice.cleanupGraceHours }),
        }),
    'version-status': (config, { client }) => {
        const schema = schemaFromConfig(config.clickhouse);
        return versionStatusJob({
            intervalMinutes: config.statusIntervalMinutes,
            thresholds: {
                watermarkAlertSeconds: config.watermarkAlertSeconds,
                unpricedShareAlert: config.unpricedAlertPercent / 100,
                buildingAlertHours: config.buildingAlertHours,
            },
            read: () =>
                versionStatuses(client, schema, {
                    pendingAlertSeconds: config.pendingAlertMinutes * 60,
                    // the retry window and a little more: an older event without a stored row is the late-row step's
                    lookbackDays: config.reprice.retryDays + 2,
                    reprice: config.reprice,
                }),
        });
    },
};

export const buildJobs = (config: WorkerConfig, deps: JobDeps): Job[] =>
    config.jobs.map((name) => FACTORIES[name](config, deps));
