import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

const base = {
    CHAIN_ID: '10',
    UPSTREAM_URL: 'http://127.0.0.1:48562',
    PORT: '48590',
    DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/cache',
};

describe('loadConfig', () => {
    it('applies the defaults', () => {
        const config = loadConfig(base);
        expect(config).toMatchObject({
            chainId: 10,
            port: 48590,
            cache: true,
            reorgDepth: 200,
            databaseConnections: 8,
            statsFile: '',
        });
        expect(config.serve.size).toBe(0);
    });

    it('reads what may be served and the cache switch', () => {
        const config = loadConfig({ ...base, SERVE: 'logs,calls', CACHE: 'off' });
        expect([...config.serve]).toEqual(['logs', 'calls']);
        expect(config.cache).toBe(false);
    });

    it('reports every problem at once', () => {
        expect(() => loadConfig({ SERVE: 'everything' })).toThrow(
            /CHAIN_ID is required[\s\S]*PORT is required|UPSTREAM_URL is required/
        );
        expect(() => loadConfig({ SERVE: 'everything' })).toThrow(/SERVE has unknown values/);
        expect(() => loadConfig({ SERVE: 'everything' })).toThrow(/DATABASE_URL is required/);
    });

    it('wants a postgres database url', () => {
        expect(() => loadConfig({ ...base, DATABASE_URL: 'http://x' })).toThrow(
            /DATABASE_URL must use postgres: or postgresql:/
        );
    });
});
