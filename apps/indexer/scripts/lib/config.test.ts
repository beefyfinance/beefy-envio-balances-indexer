import { describe, expect, it } from 'vitest';

import { ConfigError } from '../../src/lib/env.ts';
import { loadScriptsConfig } from './config.ts';

describe('scripts config', () => {
    it('applies the defaults', () => {
        expect(loadScriptsConfig({})).toEqual({
            rpcUrls: new Map(),
            beefyApiUrl: 'https://api.beefy.finance',
            postgres: { host: 'localhost', port: 5433, user: 'postgres', password: 'testing', database: 'envio-dev' },
            postgresSchema: 'public',
            psql: 'psql',
            clickhouse: { url: 'http://localhost:8123', database: 'default', username: 'default', password: '' },
        });
    });

    it('collects every ENVIO_RPC_URL_<chainId> and the connection settings', () => {
        const config = loadScriptsConfig({
            ENVIO_RPC_URL_1: 'https://eth.example',
            ENVIO_RPC_URL_8453: ' http://localhost:8545 ',
            ENVIO_RPC_URL_: 'ignored: no chain id',
            ENVIO_RPC_URL_X: 'ignored too',
            ENVIO_PG_HOST: '/var/run/postgresql',
            ENVIO_PG_PORT: '55433',
            ENVIO_PG_PASSWORD: ' spaced secret ',
            ENVIO_PG_SCHEMA: 'beefy_balances',
            ENVIO_CLICKHOUSE_HOST: 'http://localhost:18123',
            ENVIO_CLICKHOUSE_DATABASE: 'beefy_raw',
        });
        expect(config.rpcUrls).toEqual(
            new Map([
                [1, 'https://eth.example'],
                [8453, 'http://localhost:8545'],
            ])
        );
        expect(config.postgres).toMatchObject({
            host: '/var/run/postgresql',
            port: 55433,
            password: ' spaced secret ',
        });
        expect(config.postgresSchema).toBe('beefy_balances');
        expect(config.clickhouse).toMatchObject({ url: 'http://localhost:18123', database: 'beefy_raw' });
    });

    it('rejects hostile values, every problem at once, without echoing them', () => {
        let error: unknown;
        try {
            loadScriptsConfig({
                ENVIO_RPC_URL_10: 'https://user:hunter2@rpc.example/ # optimism',
                ENVIO_PG_HOST: '-c shared_preload_libraries=evil',
                ENVIO_PG_PORT: '5432 -c x',
                ENVIO_PG_DATABASE: 'db; drop',
                ENVIO_PG_SCHEMA: 'public"; drop schema x; --',
                ENVIO_CLICKHOUSE_HOST: 'gopher://localhost',
                ENVIO_CLICKHOUSE_DATABASE: 'db`.`system',
            });
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(ConfigError);
        const problems = (error as ConfigError).problems;
        expect(problems.map((problem) => problem.split(':')[0])).toEqual([
            'ENVIO_RPC_URL_10',
            'ENVIO_PG_HOST',
            'ENVIO_PG_PORT',
            'ENVIO_PG_DATABASE',
            'ENVIO_PG_SCHEMA',
            'ENVIO_CLICKHOUSE_HOST',
            'ENVIO_CLICKHOUSE_DATABASE',
        ]);
        expect((error as ConfigError).message).not.toContain('hunter2');
    });
});
