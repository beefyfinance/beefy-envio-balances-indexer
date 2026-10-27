import { describe, expect, it } from 'vitest';

import { clickhouseConfigFromEnv } from './clickhouse.ts';

describe('clickhouseConfigFromEnv', () => {
    it('has safe defaults and keeps our database apart from the indexer one', () => {
        expect(clickhouseConfigFromEnv({ CLICKHOUSE_URL: 'https://ch.example:8443' })).toEqual({
            url: 'https://ch.example:8443',
            username: 'default',
            password: '',
            rawDatabase: 'beefy_raw',
            analyticsDatabase: 'beefy_analytics',
            priceDatabase: 'dbt',
        });
    });

    it('refuses to share a database with the indexer', () => {
        expect(() =>
            clickhouseConfigFromEnv({
                CLICKHOUSE_URL: 'http://localhost:8123',
                CLICKHOUSE_RAW_DATABASE: 'same',
                CLICKHOUSE_ANALYTICS_DATABASE: 'same',
            })
        ).toThrow('must differ');
    });

    it('requires the url', () => {
        expect(() => clickhouseConfigFromEnv({})).toThrow('CLICKHOUSE_URL is required');
    });
});
