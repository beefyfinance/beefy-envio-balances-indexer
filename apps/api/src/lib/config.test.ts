import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

const base = { CLICKHOUSE_URL: 'http://localhost:8123', CLICKHOUSE_USERNAME: 'default' };

describe('api config', () => {
    it('defaults to port 3000', () => {
        expect(loadConfig(base).port).toBe(3000);
    });

    it('has safe defaults for the serving limits and trusts only the socket address', () => {
        expect(loadConfig(base)).toMatchObject({
            clientIp: 'socket',
            clientRatePerMinute: 60,
            clientBurst: 20,
            clientMissesPerMinute: 20,
            clientMissBurst: 10,
            maxInFlightQueries: 4,
            maxTimelineRows: 10_000,
            maxQueuedQueries: 64,
            maxQueueWaitMs: 250,
            cacheMegabytes: 128,
            requestTimeoutMs: 10_000,
            statusRefreshSeconds: 10,
            statusTimeoutMs: 3000,
            productContractsRefreshMinutes: 60,
            shutdownGraceSeconds: 10,
        });
    });

    it('serves /health and /metrics only with a token that cannot be guessed', () => {
        expect(loadConfig(base)).toMatchObject({ opsToken: undefined, watermarkWarnSeconds: 2 * 86_400 });
        expect(() => loadConfig({ ...base, OPS_TOKEN: 'abc' })).toThrow('OPS_TOKEN must be at least 32 characters');
        const token = 'f'.repeat(32);
        expect(loadConfig({ ...base, OPS_TOKEN: token, WATERMARK_ALERT_SECONDS: '7200' })).toMatchObject({
            opsToken: token,
            watermarkWarnSeconds: 7200,
        });
    });

    it('only accepts a known client address source', () => {
        expect(() => loadConfig({ ...base, CLIENT_IP: 'x-forwarded-for' })).toThrow('CLIENT_IP');
        expect(loadConfig({ ...base, CLIENT_IP: 'cloudflare' }).clientIp).toBe('cloudflare');
        expect(loadConfig({ ...base, CLIENT_IP: 'heroku-cloudflare' }).clientIp).toBe('heroku-cloudflare');
    });

    it('rejects invalid numbers and names, all at once', () => {
        expect(() =>
            loadConfig({
                ...base,
                PORT: 'abc',
                STATUS_REFRESH_SECONDS: '0',
                MAX_QUEUE_WAIT_MS: '1e3',
                CLICKHOUSE_ANALYTICS_DATABASE: 'db`; DROP',
            })
        ).toThrow(/PORT[\s\S]*ANALYTICS_DATABASE[\s\S]*MAX_QUEUE_WAIT_MS[\s\S]*STATUS_REFRESH_SECONDS/);
    });
});
