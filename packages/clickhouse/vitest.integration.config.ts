import { defineConfig } from 'vitest/config';

// Needs a ClickHouse with data in CLICKHOUSE_TEST_RAW_DATABASE (a database the indexer wrote); see the test file.
export default defineConfig({ test: { include: ['src/**/*.integration.test.ts'], testTimeout: 60_000 } });
