import { defineConfig } from 'vitest/config';

// Needs a ClickHouse: CLICKHOUSE_URL=http://localhost:18123
export default defineConfig({ test: { include: ['src/**/*.integration.test.ts'], testTimeout: 60_000 } });
