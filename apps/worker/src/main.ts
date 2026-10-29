import { createClickhouseClient } from '@beefy/clickhouse';
import { redact } from '@beefy/config';

import { buildJobs } from './jobs/index.ts';
import { readConfig } from './lib/config.ts';
import { log } from './lib/log.ts';
import { startScheduler } from './scheduler.ts';

const config = readConfig();
const client = createClickhouseClient({
    url: config.clickhouse.url,
    username: config.clickhouse.username,
    password: config.clickhouse.password,
});
const jobs = buildJobs(config, { client });

// Without a definer the API views run as whoever queries them (SQL SECURITY INVOKER): the API user would then need
// grants on Envio's databases, the version tables and the price tables. Fine locally, a mistake in production.
if (config.clickhouse.definer === undefined) {
    log.warn(
        { event: 'no-definer' },
        'CLICKHOUSE_DEFINER is unset: the API views will run as the invoker, which then needs read grants on everything they read'
    );
}

log.info({
    event: 'started',
    jobs: jobs.map((job) => job.name),
    clickhouse: redact(config.clickhouse.url),
    analyticsDatabase: config.clickhouse.analyticsDatabase,
});

if (jobs.length === 0) {
    log.info({ event: 'no-jobs' }, 'no jobs are selected: nothing to do');
    process.exit(0);
}

const scheduler = startScheduler(jobs);

// Heroku sends SIGTERM on every restart and gives the process 30 seconds.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        setTimeout(() => process.exit(1), config.shutdownGraceSeconds * 1000).unref();
        void scheduler
            .stop()
            .then(() => client.close())
            .then(() => process.exit(0));
    });
}
