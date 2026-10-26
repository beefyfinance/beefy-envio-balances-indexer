import { redact } from '@beefy/config';
import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig(process.env);
const server = serve({ fetch: createApp().fetch, port: config.port }, ({ port }) => {
    console.log(
        JSON.stringify({
            app: 'api',
            port,
            clickhouse: redact(config.clickhouse.url),
            analyticsDatabase: config.clickhouse.analyticsDatabase,
        })
    );
});

// Heroku sends SIGTERM on every restart and gives the process 30 seconds.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        setTimeout(() => process.exit(1), 10_000).unref();
        server.close(() => process.exit(0));
    });
}
