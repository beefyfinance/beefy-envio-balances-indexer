import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        testTimeout: 120_000, // integration tests can take a while
        // reference copies of the downstream APIs (gitignored, own dependencies)
        exclude: [...configDefaults.exclude, 'existing-apis/**'],
    },
});
