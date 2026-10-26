import type { WorkerConfig } from '../config.ts';
import type { Job } from './job.ts';
import { priceSyncJob } from './priceSync.ts';

/** Every job the worker knows. Add the name here and a factory below; `WORKER_JOBS` picks which run in a process. */
export const JOB_NAMES = ['price-sync'] as const;
export type JobName = (typeof JOB_NAMES)[number];

const FACTORIES: Record<JobName, (config: WorkerConfig) => Job> = {
    'price-sync': (config) => priceSyncJob({ intervalMinutes: config.priceSyncIntervalMinutes }),
};

export const buildJobs = (config: WorkerConfig): Job[] => config.jobs.map((name) => FACTORIES[name](config));
