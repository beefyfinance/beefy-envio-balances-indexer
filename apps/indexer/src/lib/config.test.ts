import { describe, expect, it } from 'vitest';

import { loadIndexerConfig } from './config';
import { ConfigError } from './env';

const CHAINS = [1, 8453];
const RPC = { ENVIO_RPC_URL_1: 'https://eth.example/rpc', ENVIO_RPC_URL_8453: 'https://base.example/rpc' };

/** The ConfigError thrown for `env`, outside vitest unless VITEST is set in it. */
const problems = (env: Record<string, string>) => {
    try {
        loadIndexerConfig(env, CHAINS);
    } catch (error) {
        if (error instanceof ConfigError) return error.problems;
        throw error;
    }
    throw new Error('expected a ConfigError');
};

describe('indexer config', () => {
    it('applies the defaults', () => {
        const config = loadIndexerConfig(RPC, CHAINS);
        expect(config).toEqual({
            rpcUrls: new Map([
                [1, 'https://eth.example/rpc'],
                [8453, 'https://base.example/rpc'],
            ]),
            rpc: {
                timeoutMs: 30_000,
                retryCount: 5,
                retryDelayMs: 500,
                multicallMaxCalls: 64,
                multicallMergeWaitMs: 16,
            },
            rpcFixtures: 'off',
            beefyApiUrl: 'https://api.beefy.finance',
            headPrices: {
                eventMaxAgeMs: 600_000,
                priceMaxAgeMs: 900_000,
                pricesRefreshMs: 60_000,
                mappingsRefreshMs: 600_000,
            },
        });
    });

    it('reads every variable, trimming spaces and treating blank as unset', () => {
        const config = loadIndexerConfig(
            {
                ...RPC,
                RPC_TIMEOUT_MS: ' 45000 ',
                RPC_RETRY_COUNT: '0',
                RPC_RETRY_DELAY_MS: '',
                RPC_MULTICALL_MAX_CALLS: '128',
                RPC_MULTICALL_MERGE_WAIT_MS: '0',
                BEEFY_API_URL: 'http://localhost:3000/api/',
                HEAD_PRICE_EVENT_MAX_AGE_MS: '0',
                HEAD_PRICE_MAX_AGE_MS: '120000',
                HEAD_PRICE_REFRESH_MS: '30000',
                HEAD_PRICE_MAPPINGS_REFRESH_MS: '300000',
            },
            CHAINS
        );
        expect(config.rpc).toEqual({
            timeoutMs: 45_000,
            retryCount: 0,
            retryDelayMs: 500,
            multicallMaxCalls: 128,
            multicallMergeWaitMs: 0,
        });
        expect(config.beefyApiUrl).toBe('http://localhost:3000/api');
        expect(config.headPrices).toEqual({
            eventMaxAgeMs: 0,
            priceMaxAgeMs: 120_000,
            pricesRefreshMs: 30_000,
            mappingsRefreshMs: 300_000,
        });
    });

    it('requires an RPC per chain outside vitest, and lists every problem at once', () => {
        expect(problems({ ENVIO_RPC_URL_1: 'https://eth.example/rpc', RPC_RETRY_COUNT: 'many' })).toEqual([
            'ENVIO_RPC_URL_8453: is required',
            'RPC_RETRY_COUNT: must be an integer between 0 and 20',
        ]);
    });

    it('rejects hostile and malformed values without echoing them', () => {
        const secret = 'https://user:hunter2@rpc.example/';
        const found = problems({
            ENVIO_RPC_URL_1: 'javascript:alert(1)',
            ENVIO_RPC_URL_8453: `${secret} --flag`,
            RPC_TIMEOUT_MS: '0x7530',
            RPC_RETRY_COUNT: '1e1',
            RPC_RETRY_DELAY_MS: '-1',
            RPC_MULTICALL_MAX_CALLS: '9'.repeat(400),
            HEAD_PRICE_REFRESH_MS: '60000; rm -rf /',
            BEEFY_API_URL: 'file:///etc/passwd',
            RPC_FIXTURES: 'record',
        });
        expect(found).toEqual([
            'ENVIO_RPC_URL_1: must be an http(s) URL',
            'ENVIO_RPC_URL_8453: must be an http(s) URL',
            'RPC_TIMEOUT_MS: must be an integer between 1000 and 600000',
            'RPC_RETRY_COUNT: must be an integer between 0 and 20',
            'RPC_RETRY_DELAY_MS: must be an integer between 0 and 60000',
            'RPC_MULTICALL_MAX_CALLS: must be an integer between 1 and 5000',
            'RPC_FIXTURES: RPC fixtures only run under vitest: unset it or set it to off',
            'BEEFY_API_URL: must be an http(s) URL',
            'HEAD_PRICE_REFRESH_MS: must be an integer between 5000 and 3600000',
        ]);
        expect(found.join('\n')).not.toContain('hunter2');
    });

    it('records RPC fixtures by default under vitest, where the RPC URLs are optional', () => {
        const config = loadIndexerConfig({ VITEST: 'true' }, CHAINS);
        expect(config.rpcFixtures).toBe('record');
        expect(config.rpcUrls.size).toBe(0);
        expect(loadIndexerConfig({ VITEST: 'true', RPC_FIXTURES: 'replay' }, CHAINS).rpcFixtures).toBe('replay');
        expect(() => loadIndexerConfig({ VITEST: 'true', RPC_FIXTURES: 'live' }, CHAINS)).toThrow('RPC_FIXTURES');
    });
});
