import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { throwingCommand } from './lib/cli.ts';
import {
    classifyAnswer,
    createRateController,
    findTransaction,
    pacerCommand,
    parseOptions,
    readResult,
    retryDelayMs,
} from './rpcPacer.ts';

const parse = (argv: string[]) => parseOptions(argv, throwingCommand(pacerCommand()));
const HASH = `0x${'ab'.repeat(32)}`;

describe('rpc pacer', () => {
    it('classifies rate limits, transient failures and normal answers', () => {
        expect(classifyAnswer({ status: 429, text: '' })).toBe('rate-limited');
        expect(classifyAnswer({ status: 200, text: '{"error":{"code":-32005,"message":"limit"}}' })).toBe(
            'rate-limited'
        );
        expect(classifyAnswer({ status: 200, text: '{"error":{"message":"Rate limit exceeded"}}' })).toBe(
            'rate-limited'
        );
        expect(classifyAnswer({ status: 0, text: 'TypeError: fetch failed' })).toBe('transient');
        expect(classifyAnswer({ status: 502, text: '' })).toBe('transient');
        expect(
            classifyAnswer({
                status: 200,
                text: '{"error":{"code":-32603,"message":"failsafe timeout policy exceeded"}}',
            })
        ).toBe('transient');
        expect(classifyAnswer({ status: 200, text: '{"error":{"code":-32603,"message":"Internal error"}}' })).toBe(
            'internal-error'
        );
        expect(classifyAnswer({ status: 200, text: '{"result":"0x1"}' })).toBe('ok');
        // a revert is the contract's answer, not something to retry
        expect(classifyAnswer({ status: 200, text: '{"error":{"code":3,"message":"execution reverted"}}' })).toBe('ok');
    });

    it('backs off exponentially, capped, and honours Retry-After', () => {
        expect(retryDelayMs(0, null)).toBe(500);
        expect(retryDelayMs(3, null)).toBe(4_000);
        expect(retryDelayMs(20, null)).toBe(60_000);
        expect(retryDelayMs(5, '2')).toBe(2_000);
        expect(retryDelayMs(0, 'soon')).toBe(500);
    });

    it('halves the rate once per burst of rate limits and raises it after a streak of successes', () => {
        let clock = 0;
        const rate = createRateController({ initial: 8, min: 1, max: 10, now: () => clock });
        rate.onRateLimited();
        rate.onRateLimited();
        rate.onRateLimited();
        expect(rate.rate).toBe(4);
        clock += 10_000;
        rate.onRateLimited();
        expect(rate.rate).toBe(2);
        clock += 10_000;
        rate.onRateLimited();
        clock += 10_000;
        rate.onRateLimited();
        expect(rate.rate).toBe(1);
        for (let i = 0; i < 20; i++) rate.onSuccess();
        expect(rate.rate).toBe(1.5);
        for (let i = 0; i < 20 * 50; i++) rate.onSuccess();
        expect(rate.rate).toBe(10);
    });

    it('parses and validates the command line', () => {
        expect(parse(['--upstream', 'https://a.example/rpc,http://b.example'])).toEqual({
            upstreams: ['https://a.example/rpc', 'http://b.example'],
            port: 8545,
            rps: 5,
            maxRps: 50,
            minRps: 0.2,
            concurrency: 4,
        });
        expect(parse(['--upstream', 'http://a', '--port', '9000', '--rps', '2.5', '--concurrency', '8'])).toMatchObject(
            {
                port: 9000,
                rps: 2.5,
                concurrency: 8,
            }
        );
        expect(() => parse([])).toThrow('--upstream');
        expect(() => parse(['--upstream', 'file:///etc/passwd'])).toThrow('http(s) URL');
        expect(() => parse(['--upstream', 'http://a', '--port', '80; rm -rf /'])).toThrow('integer');
        expect(() => parse(['--upstream', 'http://a', '--rps', '-1'])).toThrow('--rps');
        expect(() => parse(['--upstream', 'http://a', '--rps', '100'])).toThrow('--min-rps <= --rps <= --max-rps');
        expect(() => parse(['--upstream', 'http://a', '--bogus', '1'])).toThrow('--bogus');
    });

    it('reads only well-formed upstream answers and transactions', () => {
        const receipt = z.object({ blockNumber: z.string() }).nullable();
        expect(readResult('{"jsonrpc":"2.0","id":1,"result":{"blockNumber":"0x10"}}', receipt)).toEqual({
            blockNumber: '0x10',
        });
        expect(readResult('{"jsonrpc":"2.0","id":1,"result":null}', receipt)).toBeNull();
        expect(readResult('{"jsonrpc":"2.0","id":1,"result":{"blockNumber":16}}', receipt)).toBeUndefined();
        expect(readResult('not json', receipt)).toBeUndefined();
        expect(readResult('[1,2]', receipt)).toBeUndefined();

        const transaction = { hash: HASH, from: '0x01', input: '0x' };
        expect(findTransaction({ transactions: ['0xabc', null, { hash: 1 }, transaction] }, HASH)).toEqual(transaction);
        expect(findTransaction({ transactions: [{ hash: `${HASH}"` }] }, HASH)).toBeNull();
        expect(findTransaction({ transactions: 'all' }, HASH)).toBeNull();
        expect(findTransaction(null, HASH)).toBeNull();
    });
});
