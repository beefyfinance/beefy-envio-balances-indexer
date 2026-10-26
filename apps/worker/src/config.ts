import {
    type ClickhouseConfig,
    clickhouseReader,
    type Env,
    integer,
    listOf,
    parseEnv,
    requiredUrl,
} from '@beefy/config';

import { JOB_NAMES, type JobName } from './jobs/index.ts';

export type WorkerConfig = {
    jobs: JobName[];
    timescaleUrl: string;
    priceSyncIntervalMinutes: number;
    clickhouse: ClickhouseConfig;
};

export const loadConfig = (env: Env): WorkerConfig =>
    parseEnv(env, {
        jobs: listOf('WORKER_JOBS', JOB_NAMES, JOB_NAMES),
        timescaleUrl: requiredUrl('TIMESCALE_DATABASE_URL', ['postgres:', 'postgresql:']),
        priceSyncIntervalMinutes: integer('PRICE_SYNC_INTERVAL_MINUTES', 15, { min: 1, max: 24 * 60 }),
        clickhouse: clickhouseReader,
    });
