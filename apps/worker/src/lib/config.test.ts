import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

const base = {
    CLICKHOUSE_URL: 'http://localhost:8123',
    CLICKHOUSE_USERNAME: 'default',
    CLICKHOUSE_ENVIO_DATABASE_PREFIX: 'envio_dev_',
};

describe('worker config', () => {
    it('runs every job by default, with the safe ClickHouse defaults', () => {
        const config = loadConfig(base);
        expect(config.jobs).toEqual(['advance', 'cleanup', 'version-status']);
        expect(config).toMatchObject({
            advanceIntervalMinutes: 15,
            cleanupIntervalHours: 24,
            statusIntervalMinutes: 5,
            watermarkAlertSeconds: 2 * 86_400,
            unpricedAlertPercent: 50,
            buildingAlertHours: 168,
            pendingAlertMinutes: 30,
            shutdownGraceSeconds: 10,
        });
        expect(config.reprice).toEqual({
            stepDays: 7,
            maxEventsPerStatement: 500_000,
            maxMemoryBytes: 4096 * 1024 * 1024,
            maxExecutionSeconds: 600,
            retryDays: 7,
            pendingGraceSeconds: 900,
            watermarkMinAgeSeconds: 86_400,
            cleanupGraceHours: 48,
        });
        expect(config.clickhouse).toMatchObject({
            analyticsDatabase: 'beefy_analytics',
            price5mTable: 'analytics.asset_price_5m',
            tokenTable: 'analytics.token',
            watermarkPriceSources: ['api', 'beefy_db'],
            definer: undefined,
            envioDatabasePrefix: 'envio_dev_',
        });
    });

    it('reads the job selection and their settings', () => {
        const config = loadConfig({
            ...base,
            WORKER_JOBS: 'advance',
            ADVANCE_INTERVAL_MINUTES: '5',
            CLEANUP_GRACE_HOURS: '72',
            REPRICE_MAX_EVENTS: '100000',
            CLICKHOUSE_DEFINER: 'beefy_pipeline',
        });
        expect(config).toMatchObject({ jobs: ['advance'], advanceIntervalMinutes: 5 });
        expect(config.reprice).toMatchObject({ cleanupGraceHours: 72, maxEventsPerStatement: 100_000 });
        expect(config.clickhouse.definer).toBe('beefy_pipeline');
    });

    it('rejects a job that does not exist', () => {
        expect(() => loadConfig({ ...base, WORKER_JOBS: 'price-sync' })).toThrow('unknown values price-sync');
    });

    it('rejects an interval out of range, a price table that is not database.table, and a malformed limit', () => {
        expect(() => loadConfig({ ...base, ADVANCE_INTERVAL_MINUTES: '0' })).toThrow('ADVANCE_INTERVAL_MINUTES');
        expect(() => loadConfig({ ...base, CLICKHOUSE_PRICE_5M_TABLE: 'bars' })).toThrow('CLICKHOUSE_PRICE_5M_TABLE');
        expect(() => loadConfig({ ...base, REPRICE_MAX_MEMORY_MB: '4G' })).toThrow('REPRICE_MAX_MEMORY_MB');
    });

    it('requires the ClickHouse url and the Envio database prefix', () => {
        expect(() => loadConfig({})).toThrow('CLICKHOUSE_URL is required');
        expect(() => loadConfig({ CLICKHOUSE_URL: 'http://localhost:8123' })).toThrow(
            'CLICKHOUSE_ENVIO_DATABASE_PREFIX is required'
        );
    });
});
