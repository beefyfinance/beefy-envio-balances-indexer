import { clickhouseConfigFromEnv } from '@beefy/config';

import { createClickhouseClient } from './client.ts';
import { attach, migrate } from './migrate.ts';
import { stampRangeStatement } from './pricing.ts';
import { DEFAULT_SIZE, seedSynthetic } from './synthetic.ts';

const USAGE = `usage: cli.ts <command>
  migrate                       create our database and tables
  attach                        (re)create the views over the indexer database and load what it already holds
  stamp <from> <to>             price events with a timestamp in [from, to), dates as YYYY-MM-DD (catch-up and backfill)
  seed-synthetic [events]       fill a load-test setup (never run against the production databases)`;

const config = clickhouseConfigFromEnv(process.env);
const client = createClickhouseClient({ url: config.url, username: config.username, password: config.password });
const db = { raw: config.rawDatabase, analytics: config.analyticsDatabase, prices: config.priceDatabase };

const [command, ...args] = process.argv.slice(2);
if (command === 'migrate') {
    await migrate(client, db);
} else if (command === 'attach') {
    await attach(client, db);
} else if (command === 'stamp' && args[0] !== undefined && args[1] !== undefined) {
    await client.command(stampRangeStatement(db, args[0], args[1]));
} else if (command === 'seed-synthetic') {
    if (process.env['ALLOW_SYNTHETIC'] !== 'yes') {
        throw new Error(
            'seed-synthetic writes fake data: set ALLOW_SYNTHETIC=yes and point the databases at a scratch ClickHouse'
        );
    }
    await seedSynthetic(client, db, { ...DEFAULT_SIZE, events: Number(args[0] ?? DEFAULT_SIZE.events) });
} else {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
}
