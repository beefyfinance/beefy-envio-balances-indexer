import { writeFileSync } from 'node:fs';

import { redact } from '@beefy/config';
import postgres from 'postgres';

import type { Context } from './context.ts';
import { createHead } from './head.ts';
import { readConfig } from './lib/config.ts';
import { log } from './lib/log.ts';
import { createRecorder } from './recorder.ts';
import { createServer } from './server.ts';
import { createStats } from './stats.ts';
import { createUpstream } from './upstream.ts';

const config = readConfig();
const stats = createStats();
const upstream = createUpstream(config.upstreamUrl, stats);
const head = createHead(upstream, config.reorgDepth);
const options = { onnotice: () => {} };
const read = postgres(config.databaseUrl, { ...options, max: config.databaseConnections });
const write = postgres(config.databaseUrl, { ...options, max: 1 });
const recorder = createRecorder(write, config, head, stats);
const context: Context = { config, read, upstream, recorder, stats, head };

const report = (): void => {
    if (config.statsFile === '') return;
    writeFileSync(
        config.statsFile,
        JSON.stringify(
            {
                cache: config.cache,
                serve: [...config.serve],
                head: head.value(),
                rssMb: Math.round(process.memoryUsage.rss() / 1e6),
                ...stats.report(),
            },
            null,
            1
        )
    );
};

await head.refresh();
setInterval(() => void head.refresh(), 15_000).unref();
setInterval(report, config.reportSeconds * 1000).unref();
if (config.cache) recorder.start();

const server = createServer(context).listen(config.port, '127.0.0.1', () => {
    log.info(
        {
            event: 'started',
            chainId: config.chainId,
            port: config.port,
            upstream: redact(config.upstreamUrl),
            serve: [...config.serve],
            cache: config.cache,
        },
        'rpc cache proxy started'
    );
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        server.close();
        void recorder
            .stop()
            .then(() => {
                report();
                return Promise.all([read.end(), write.end()]);
            })
            .then(() => process.exit(0));
    });
}
