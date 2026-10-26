import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

const BASE = {
    TIMESCALE_DATABASE_URL: 'postgresql://ro:pw@db.example:5432/tsdb?sslmode=require',
    CLICKHOUSE_URL: 'http://localhost:8123',
};

describe('worker config', () => {
    it('runs every job every 15 minutes by default', () => {
        const config = loadConfig(BASE);
        expect(config.jobs).toEqual(['price-sync']);
        expect(config.priceSyncIntervalMinutes).toBe(15);
        expect(config.clickhouse.analyticsDatabase).toBe('beefy_analytics');
    });

    it('rejects unknown jobs', () => {
        expect(() => loadConfig({ ...BASE, WORKER_JOBS: 'price-sync,nope' })).toThrow('unknown values nope');
    });

    it('collects every problem', () => {
        expect(() => loadConfig({ PRICE_SYNC_INTERVAL_MINUTES: '0' })).toThrow(
            /TIMESCALE_DATABASE_URL is required[\s\S]*PRICE_SYNC_INTERVAL_MINUTES[\s\S]*CLICKHOUSE_URL is required/
        );
    });
});
