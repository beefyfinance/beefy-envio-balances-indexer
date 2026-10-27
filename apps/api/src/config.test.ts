import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

describe('api config', () => {
    it('defaults to port 3000', () => {
        expect(loadConfig({ CLICKHOUSE_URL: 'http://localhost:8123' }).port).toBe(3000);
    });

    it('has safe defaults for the serving limits and trusts only the socket address', () => {
        expect(loadConfig({ CLICKHOUSE_URL: 'http://localhost:8123' })).toMatchObject({
            clientIp: 'socket',
            clientRatePerMinute: 60,
            clientBurst: 20,
            maxInFlightQueries: 8,
            maxQueuedQueries: 64,
            cacheMegabytes: 128,
        });
    });

    it('only accepts a known client address source', () => {
        expect(() => loadConfig({ CLICKHOUSE_URL: 'http://localhost:8123', CLIENT_IP: 'x-forwarded-for' })).toThrow(
            'CLIENT_IP'
        );
        expect(loadConfig({ CLICKHOUSE_URL: 'http://localhost:8123', CLIENT_IP: 'cloudflare' }).clientIp).toBe(
            'cloudflare'
        );
    });

    it('rejects an invalid port', () => {
        expect(() => loadConfig({ CLICKHOUSE_URL: 'http://localhost:8123', PORT: 'abc' })).toThrow('PORT');
    });
});
