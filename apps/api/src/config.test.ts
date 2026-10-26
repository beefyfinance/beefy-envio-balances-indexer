import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

describe('api config', () => {
    it('defaults to port 3000', () => {
        expect(loadConfig({ CLICKHOUSE_URL: 'http://localhost:8123' }).port).toBe(3000);
    });

    it('rejects an invalid port', () => {
        expect(() => loadConfig({ CLICKHOUSE_URL: 'http://localhost:8123', PORT: 'abc' })).toThrow('PORT');
    });
});
