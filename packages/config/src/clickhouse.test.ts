import { describe, expect, it } from 'vitest';

import { clickhouseConfigFromEnv, clickhouseReader, repriceSettings } from './clickhouse.ts';
import { parseEnv } from './env.ts';

describe('clickhouseConfigFromEnv', () => {
    it('has safe defaults', () => {
        expect(
            clickhouseConfigFromEnv({
                CLICKHOUSE_URL: 'https://ch.example:8443',
                CLICKHOUSE_USERNAME: 'beefy_pipeline',
                CLICKHOUSE_PASSWORD: 'secret',
                CLICKHOUSE_ENVIO_DATABASE_PREFIX: 'envio_dev_mrt_',
            })
        ).toEqual({
            url: 'https://ch.example:8443',
            username: 'beefy_pipeline',
            password: 'secret',
            analyticsDatabase: 'beefy_analytics',
            price5mTable: 'analytics.asset_price_5m',
            tokenTable: 'analytics.token',
            watermarkPriceSources: ['api', 'beefy_db'],
            definer: undefined,
            envioDatabasePrefix: 'envio_dev_mrt_',
        });
    });

    it('reads the watermark sources and the definer', () => {
        expect(
            clickhouseConfigFromEnv({
                CLICKHOUSE_URL: 'http://localhost:8123',
                CLICKHOUSE_USERNAME: 'default',
                CLICKHOUSE_ENVIO_DATABASE_PREFIX: 'envio_dev_',
                CLICKHOUSE_WATERMARK_PRICE_SOURCES: ' api , ',
                CLICKHOUSE_DEFINER: 'beefy_pipeline',
            })
        ).toMatchObject({ watermarkPriceSources: ['api'], definer: 'beefy_pipeline' });
    });

    it('refuses names and sources that are not plain, whatever they contain', () => {
        for (const hostile of ["x'", 'a`b', 'a;b', 'a{b}', 'a\nb', 'a b']) {
            expect(() =>
                clickhouseConfigFromEnv({
                    CLICKHOUSE_URL: 'http://localhost:8123',
                    CLICKHOUSE_USERNAME: 'default',
                    CLICKHOUSE_ENVIO_DATABASE_PREFIX: hostile,
                    CLICKHOUSE_ANALYTICS_DATABASE: hostile,
                    CLICKHOUSE_PRICE_5M_TABLE: hostile,
                    CLICKHOUSE_TOKEN_TABLE: hostile,
                    CLICKHOUSE_WATERMARK_PRICE_SOURCES: `api,${hostile}`,
                    CLICKHOUSE_DEFINER: hostile,
                })
            ).toThrow(
                /ANALYTICS_DATABASE[\s\S]*PRICE_5M_TABLE[\s\S]*TOKEN_TABLE[\s\S]*WATERMARK_PRICE_SOURCES[\s\S]*DEFINER[\s\S]*ENVIO_DATABASE_PREFIX/
            );
        }
    });

    it('requires the url, the user and the Envio database prefix', () => {
        expect(() => clickhouseConfigFromEnv({})).toThrow(
            /CLICKHOUSE_URL is required[\s\S]*CLICKHOUSE_USERNAME is required[\s\S]*CLICKHOUSE_ENVIO_DATABASE_PREFIX is required/
        );
    });

    it('accepts an empty password for a ClickHouse on localhost only', () => {
        const env = { CLICKHOUSE_USERNAME: 'default', CLICKHOUSE_ENVIO_DATABASE_PREFIX: 'envio_dev_' };
        for (const url of ['http://localhost:8123', 'http://127.0.0.1:8123', 'http://[::1]:8123']) {
            expect(clickhouseConfigFromEnv({ ...env, CLICKHOUSE_URL: url }).password).toBe('');
        }
        expect(() => clickhouseConfigFromEnv({ ...env, CLICKHOUSE_URL: 'https://ch.example:8443' })).toThrow(
            'CLICKHOUSE_PASSWORD is required'
        );
    });

    it('refuses an Envio database prefix that is short, open ended, or covers one of our databases', () => {
        const env = { CLICKHOUSE_URL: 'http://localhost:8123', CLICKHOUSE_USERNAME: 'default' };
        for (const prefix of ['e_', 'envio', 'envio_dev']) {
            expect(() => clickhouseConfigFromEnv({ ...env, CLICKHOUSE_ENVIO_DATABASE_PREFIX: prefix })).toThrow(
                'at least 4 characters ending with _'
            );
        }
        expect(() =>
            clickhouseConfigFromEnv({
                ...env,
                CLICKHOUSE_ENVIO_DATABASE_PREFIX: 'beefy_',
                CLICKHOUSE_ANALYTICS_DATABASE: 'beefy_analytics',
            })
        ).toThrow('must not be a prefix of beefy_analytics');
        expect(() =>
            clickhouseConfigFromEnv({
                ...env,
                CLICKHOUSE_ENVIO_DATABASE_PREFIX: 'analytics_',
                CLICKHOUSE_TOKEN_TABLE: 'analytics_x.token',
            })
        ).toThrow('must not be a prefix of analytics_x');
    });
});

describe('clickhouseReader', () => {
    it('reads the connection only', () => {
        expect(
            parseEnv(
                { CLICKHOUSE_URL: 'http://localhost:8123', CLICKHOUSE_USERNAME: 'default' },
                { c: clickhouseReader() }
            ).c
        ).toEqual({
            url: 'http://localhost:8123',
            username: 'default',
            password: '',
            analyticsDatabase: 'beefy_analytics',
        });
        expect(() =>
            parseEnv({ CLICKHOUSE_URL: 'ftp://x', CLICKHOUSE_USERNAME: 'u' }, { c: clickhouseReader() })
        ).toThrow('must use http: or https:');
    });
});

describe('repriceSettings', () => {
    it('has the defaults the worker and the CLI share, in base units', () => {
        expect(parseEnv({}, { r: repriceSettings() }).r).toEqual({
            stepDays: 7,
            maxEventsPerStatement: 500_000,
            maxMemoryBytes: 4096 * 1024 * 1024,
            maxExecutionSeconds: 600,
            retryDays: 7,
            pendingGraceSeconds: 900,
            watermarkMinAgeSeconds: 86_400,
            cleanupGraceHours: 48,
        });
    });

    it('reads overrides and refuses values out of range', () => {
        expect(
            parseEnv({ REPRICE_MAX_EVENTS: '20000', REPRICE_MAX_MEMORY_MB: '512' }, { r: repriceSettings() }).r
        ).toMatchObject({
            maxEventsPerStatement: 20_000,
            maxMemoryBytes: 512 * 1024 * 1024,
        });
        expect(() =>
            parseEnv({ REPRICE_MAX_EVENTS: '10', ADVANCE_STEP_DAYS: '7; DROP' }, { r: repriceSettings() })
        ).toThrow(/ADVANCE_STEP_DAYS[\s\S]*REPRICE_MAX_EVENTS/);
    });
});
