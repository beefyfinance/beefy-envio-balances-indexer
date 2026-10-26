import { redact } from '@beefy/config';

import { loadConfig } from './config.ts';
import { buildJobs } from './jobs/index.ts';
import { startScheduler } from './scheduler.ts';

const config = loadConfig(process.env);
const jobs = buildJobs(config);

console.log(
    JSON.stringify({
        app: 'worker',
        jobs: jobs.map((job) => job.name),
        timescale: redact(config.timescaleUrl),
        clickhouse: redact(config.clickhouse.url),
        analyticsDatabase: config.clickhouse.analyticsDatabase,
    })
);

const scheduler = startScheduler(jobs, (event) => console.log(JSON.stringify(event)));

// Heroku sends SIGTERM on every restart and gives the process 30 seconds.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        setTimeout(() => process.exit(1), 10_000).unref();
        void scheduler.stop().then(() => process.exit(0));
    });
}
