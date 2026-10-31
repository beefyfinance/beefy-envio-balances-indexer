import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { throwingCommand } from './lib/cli.ts';
import {
    classifyAnswer,
    createRateController,
    createUpstream,
    findTransaction,
    logRangeOf,
    pacerCommand,
    parseOptions,
    pickUpstream,
    readResult,
    retryDelayMs,
    startPacer,
    withTransactionHashes,
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

    it('recognises the log ranges providers refuse', () => {
        for (const message of [
            'ranges over 10000 blocks are not supported on free plan',
            'block range too large: total block range in this request exceeds the maximum of 100 blocks',
            'Block range too large: maximum allowed is 50 blocks on your current plan.',
            'query returned more than 10000 results',
        ]) {
            expect(
                classifyAnswer({ status: 400, text: JSON.stringify({ error: { code: 35, message: message } }) })
            ).toBe('range-refused');
        }
        // a rate limit stays one, whatever its body says
        expect(classifyAnswer({ status: 429, text: 'block range too large' })).toBe('rate-limited');
    });

    it('sends a request to the upstream free soonest, preferring the ones it has not tried', () => {
        const rate = () => createRateController({ initial: 1, min: 1, max: 1 });
        const [a, b, c] = ['http://a', 'http://b', 'http://c'].map((url) => createUpstream(url, rate()));
        const upstreams = [a, b, c];
        const none = new Set<never>();
        const pick = (tried: Set<unknown> = none, refused: Set<unknown> = none) =>
            pickUpstream(upstreams, {
                tried: tried as Set<typeof a>,
                refused: refused as Set<typeof a>,
                concurrency: 2,
                now: 1_000,
            })?.url;

        a.nextSlot = 2_000;
        b.pausedUntil = 5_000;
        expect(pick()).toBe('http://c');
        c.inFlight = 2;
        expect(pick()).toBe('http://a');
        // c is at its cap; tried a and b: wait for c rather than go back to them
        expect(pick(new Set([a, b]))).toBeUndefined();
        c.inFlight = 0;
        expect(pick(new Set([a, b]))).toBe('http://c');
        // every one tried: the one free soonest again
        expect(pick(new Set([a, b, c]))).toBe('http://c');
        // refused the range: never again for this request
        expect(pick(none, new Set([c]))).toBe('http://a');
        expect(pick(none, new Set([a, b, c]))).toBeUndefined();
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

    describe('over fake upstreams', () => {
        const closers: Array<() => Promise<void>> = [];
        afterEach(async () => {
            for (const close of closers.splice(0)) await close();
        });

        /** A local upstream answering every request with `respond`; counts what it receives. */
        const fakeUpstream = async (
            respond: (body: string) => { status: number; body: unknown; headers?: Record<string, string> }
        ) => {
            const received: string[] = [];
            const server = http.createServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', (chunk: Buffer) => chunks.push(chunk));
                req.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8');
                    received.push(body);
                    const { status, body: answer, headers } = respond(body);
                    res.writeHead(status, { 'content-type': 'application/json', ...headers });
                    res.end(JSON.stringify(answer));
                });
            });
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
            closers.push(
                () =>
                    new Promise<void>((resolve) => {
                        server.close(() => resolve());
                        server.closeAllConnections();
                    })
            );
            return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
        };

        const pacerOver = async (urls: string[], { headRefreshMs = 0 }: { headRefreshMs?: number } = {}) => {
            const pacer = startPacer(
                { upstreams: urls, port: 0, rps: 1_000, maxRps: 1_000, minRps: 1, concurrency: 4 },
                { headRefreshMs }
            );
            closers.push(pacer.close);
            const port = await pacer.listening;
            const ask = async (method: string, params: unknown[] = [], id: number | string = 1) => {
                const response = await fetch(`http://127.0.0.1:${port}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
                });
                return { status: response.status, body: (await response.json()) as unknown };
            };
            return { pacer, ask };
        };

        const ok = { status: 200, body: { jsonrpc: '2.0', id: 1, result: '0x1' } };

        it('spreads requests over the upstreams', async () => {
            const a = await fakeUpstream(() => ok);
            const b = await fakeUpstream(() => ok);
            const { ask } = await pacerOver([a.url, b.url]);
            const answers = await Promise.all(Array.from({ length: 20 }, () => ask('eth_blockNumber')));
            expect(answers.every((answer) => answer.status === 200)).toBe(true);
            expect(a.received.length).toBeGreaterThan(0);
            expect(b.received.length).toBeGreaterThan(0);
            expect(a.received.length + b.received.length).toBe(20);
        });

        it('moves a rate-limited request to another upstream and pauses the limited one', async () => {
            const limited = await fakeUpstream(() => ({ status: 429, body: { error: 'too many requests' } }));
            const healthy = await fakeUpstream(() => ok);
            const { pacer, ask } = await pacerOver([limited.url, healthy.url]);
            for (let i = 0; i < 5; i++) expect((await ask('eth_blockNumber')).body).toMatchObject({ result: '0x1' });
            // limited once, then paused: everything else went to the healthy one
            expect(limited.received).toHaveLength(1);
            expect(healthy.received).toHaveLength(5);
            expect(pacer.upstreams[0]?.pausedUntil).toBeGreaterThan(Date.now());
        });

        it('asks the other upstreams for a log range one refuses, and returns the refusal when all refuse', async () => {
            const refusal = {
                status: 400,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    error: { code: 35, message: 'ranges over 10000 blocks are not supported' },
                },
            };
            const narrow = await fakeUpstream(() => refusal);
            const wide = await fakeUpstream(() => ok);
            const both = await pacerOver([narrow.url, wide.url]);
            for (let i = 0; i < 4; i++) expect((await both.ask('eth_getLogs')).body).toMatchObject({ result: '0x1' });
            expect(wide.received).toHaveLength(4);

            // the refusal taught the pacer the narrow upstream's limit: the same wide range no longer goes to it
            const asked = narrow.received.length;
            for (let i = 0; i < 6; i++) await both.ask('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x3e8' }]);
            // at most one refusal (whichever request reached it first), then never again
            expect(narrow.received.length - asked).toBeLessThanOrEqual(1);
            expect(both.pacer.upstreams[0]?.maxLogRange ?? 999).toBe(999);
            expect(
                logRangeOf(JSON.stringify({ method: 'eth_getLogs', params: [{ fromBlock: '0x1', toBlock: '0x3e8' }] }))
            ).toBe(1000);
            expect(
                logRangeOf(JSON.stringify({ method: 'eth_getLogs', params: [{ fromBlock: '0x1', toBlock: 'latest' }] }))
            ).toBeUndefined();

            const narrowToo = await fakeUpstream(() => refusal);
            const neither = await pacerOver([narrow.url, narrowToo.url]);
            const answer = await neither.ask('eth_getLogs');
            expect(answer.status).toBe(400);
            expect(answer.body).toMatchObject({ error: { code: 35 } });
        });

        it('asks the other upstreams for state one has pruned, and returns the error when none has it', async () => {
            const noState = {
                status: 200,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    error: { code: -32000, message: 'Unknown state. First available state is 1' },
                },
            };
            const pruned = await fakeUpstream(() => noState);
            const archive = await fakeUpstream(() => ok);
            const both = await pacerOver([pruned.url, archive.url]);
            for (let i = 0; i < 4; i++) expect((await both.ask('eth_call')).body).toMatchObject({ result: '0x1' });
            expect(archive.received).toHaveLength(4);

            const prunedToo = await fakeUpstream(() => noState);
            const neither = await pacerOver([pruned.url, prunedToo.url]);
            expect((await neither.ask('eth_call')).body).toMatchObject({ error: { code: -32000 } });
        });

        it('asks the other upstreams for a block up to the head one answers null for, and takes null past it', async () => {
            const answers = (result: (number: number) => unknown) => (body: string) => {
                const { id, method, params } = JSON.parse(body) as { id: unknown; method: string; params: unknown[] };
                if (method === 'eth_blockNumber')
                    return { status: 200, body: { jsonrpc: '2.0', id, result: '0x2710' } };
                return {
                    status: 200,
                    body: { jsonrpc: '2.0', id, result: result(Number.parseInt(params[0] as string, 16)) },
                };
            };
            const pruned = await fakeUpstream(answers(() => null));
            const archive = await fakeUpstream(answers((number) => (number <= 10_000 ? { number } : null)));
            const { ask } = await pacerOver([pruned.url, archive.url], { headRefreshMs: 60_000 });
            await expect.poll(() => archive.received.length + pruned.received.length).toBeGreaterThan(0);
            await new Promise((resolve) => setTimeout(resolve, 50));

            for (let i = 0; i < 4; i++) {
                expect((await ask('eth_getBlockByNumber', ['0x64', false])).body).toMatchObject({
                    result: { number: 100 },
                });
                expect((await ask('eth_getBlockByNumber', ['0x270f', false])).body).toMatchObject({
                    result: { number: 9_999 },
                });
            }
            expect((await ask('eth_getBlockByNumber', ['0x2711', false])).body).toMatchObject({ result: null });
        });

        it('takes null for a block near the head without waiting for a paused upstream', async () => {
            const answers = (result: unknown) => (body: string) => {
                const { id, method } = JSON.parse(body) as { id: unknown; method: string };
                return {
                    status: 200,
                    body: { jsonrpc: '2.0', id, result: method === 'eth_blockNumber' ? '0x2710' : result },
                };
            };
            const behind = await fakeUpstream(answers(null));
            const limited = await fakeUpstream((body) =>
                (JSON.parse(body) as { method: string }).method === 'eth_blockNumber'
                    ? answers(null)(body)
                    : { status: 429, headers: { 'retry-after': '60' }, body: { error: 'too many requests' } }
            );
            const { ask } = await pacerOver([behind.url, limited.url], { headRefreshMs: 60_000 });
            await expect.poll(() => behind.received.length + limited.received.length).toBeGreaterThan(0);
            await new Promise((resolve) => setTimeout(resolve, 50));

            // the first request learns the pause; the second must not wait it out
            await ask('eth_getBlockByNumber', ['0x270f', false]);
            const started = Date.now();
            expect((await ask('eth_getBlockByNumber', ['0x270f', false])).body).toMatchObject({ result: null });
            expect(Date.now() - started).toBeLessThan(2_000);
        }, 10_000);

        it('asks the other upstreams for a block with logs that one returns without transactions', async () => {
            const hash = `0x${'cd'.repeat(32)}`;
            const answers = (transactions: unknown[]) => (body: string) => {
                const { id, method } = JSON.parse(body) as { id: unknown; method: string };
                const result =
                    method === 'eth_blockNumber'
                        ? '0x2710'
                        : method === 'eth_getLogs'
                          ? [{ transactionHash: hash, blockNumber: '0x64' }]
                          : { number: '0x64', hash: `0x${'bb'.repeat(32)}`, timestamp: '0x1', transactions };
                return { status: 200, body: { jsonrpc: '2.0', id, result } };
            };
            const emptied = await fakeUpstream(answers([]));
            const archive = await fakeUpstream(answers([{ hash, from: `0x${'aa'.repeat(20)}` }]));
            const { ask } = await pacerOver([emptied.url, archive.url], { headRefreshMs: 60_000 });
            await expect.poll(() => emptied.received.length + archive.received.length).toBeGreaterThan(0);
            await new Promise((resolve) => setTimeout(resolve, 50));

            await ask('eth_getLogs', [{}]);
            for (let i = 0; i < 4; i++) {
                expect((await ask('eth_getTransactionByHash', [hash])).body).toMatchObject({ result: { hash } });
            }
        });

        it('drops a queued request once its client has gone', async () => {
            const upstream = await fakeUpstream(() => ok);
            const pacer = startPacer(
                { upstreams: [upstream.url], port: 0, rps: 1, maxRps: 1, minRps: 1, concurrency: 1 },
                { headRefreshMs: 0 }
            );
            closers.push(pacer.close);
            const port = await pacer.listening;
            const post = (signal?: AbortSignal) =>
                fetch(`http://127.0.0.1:${port}`, {
                    method: 'POST',
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
                    ...(signal ? { signal } : {}),
                });
            await post();
            // one request a second: this one waits for its slot, and its client leaves first
            await expect(post(AbortSignal.timeout(100))).rejects.toThrow('timeout');
            await new Promise((resolve) => setTimeout(resolve, 1_100));
            expect(upstream.received).toHaveLength(1);
        });

        it('answers the block and transactions of a settled block from one fetch, and leaves recent blocks alone', async () => {
            const tx = (n: number) => ({ hash: `0x${n.toString(16).padStart(64, '0')}`, from: `0x${'aa'.repeat(20)}` });
            const block = (number: number) => ({
                number: `0x${number.toString(16)}`,
                hash: `0x${'bb'.repeat(32)}`,
                timestamp: '0x1',
                transactions: [tx(number * 10), tx(number * 10 + 1)],
            });
            const upstream = await fakeUpstream((body) => {
                const { id, method, params } = JSON.parse(body) as { id: unknown; method: string; params: unknown[] };
                const result =
                    method === 'eth_blockNumber'
                        ? '0x2710' // 10000
                        : method === 'eth_getLogs'
                          ? [
                                { transactionHash: tx(1000).hash, blockNumber: '0x64' }, // block 100: settled
                                { transactionHash: tx(99_990).hash, blockNumber: '0x270f' }, // block 9999: recent
                            ]
                          : method === 'eth_getBlockByNumber'
                            ? params[1] === true
                                ? block(Number.parseInt(params[0] as string, 16))
                                : withTransactionHashes(block(Number.parseInt(params[0] as string, 16)))
                            : method === 'eth_getTransactionByHash'
                              ? tx(99_990)
                              : null;
                return { status: 200, body: { jsonrpc: '2.0', id, result } };
            });
            const { pacer, ask } = await pacerOver([upstream.url], { headRefreshMs: 60_000 });
            const methodsSent = () => upstream.received.map((body) => (JSON.parse(body) as { method: string }).method);
            await expect.poll(() => methodsSent()).toContain('eth_blockNumber');

            await ask('eth_getLogs', [{}]);
            const [header, first, second] = await Promise.all([
                ask('eth_getBlockByNumber', ['0x64', false], 7),
                ask('eth_getTransactionByHash', [tx(1000).hash], 'a'),
                ask('eth_getTransactionByHash', [tx(1001).hash], 'b'),
            ]);
            // the settled block was fetched once, with its transactions; only the transaction the logs did not place
            // in it went upstream
            expect(methodsSent().filter((method) => method === 'eth_getBlockByNumber')).toHaveLength(1);
            expect(upstream.received.filter((body) => body.includes('eth_getTransactionByHash'))).toEqual([
                expect.stringContaining(tx(1001).hash),
            ]);
            expect(header.body).toEqual({ jsonrpc: '2.0', id: 7, result: withTransactionHashes(block(100)) });
            expect(first.body).toEqual({ jsonrpc: '2.0', id: 'a', result: tx(1000) });
            // a transaction of that block missing from the logs is not known to be in it: asked upstream
            expect(second.body).toMatchObject({ id: 'b' });

            // near the head: passed through as asked
            await ask('eth_getBlockByNumber', ['0x270f', false]);
            await ask('eth_getTransactionByHash', [tx(99_990).hash]);
            expect(methodsSent().slice(-2)).toEqual(['eth_getBlockByNumber', 'eth_getTransactionByHash']);
            expect(pacer.stats.fromBlockCache).toBe(2);
            expect(pacer.stats.blocksFetched).toBe(1);
        });
    });
});
