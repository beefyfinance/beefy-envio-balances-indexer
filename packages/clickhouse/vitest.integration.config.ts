import { defineConfig } from 'vitest/config';

// Needs a scratch ClickHouse (CLICKHOUSE_URL=http://localhost:18123); every test creates and drops its own databases.
export default defineConfig({ test: { include: ['src/**/*.integration.test.ts'], testTimeout: 60_000 } });
