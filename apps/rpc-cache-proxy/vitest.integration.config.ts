import { defineConfig } from 'vitest/config';

// Needs a scratch Postgres (DATABASE_URL, with sql/schema.sql applied); the test only touches chain id 999999.
export default defineConfig({ test: { include: ['test/**/*.integration.test.ts'], testTimeout: 60_000 } });
