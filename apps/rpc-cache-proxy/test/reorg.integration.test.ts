import { type ChildProcess, spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

// A fake node that switches fork, behind the real proxy and a real Postgres: what the cache answers must always match
// the canonical chain. Needs DATABASE_URL (a scratch database with sql/schema.sql applied); only chain 999999 is touched.
const CHAIN = 999_999;
const databaseUrl = process.env['DATABASE_URL'];
const address = `0x${'aa'.repeat(20)}`;
const topic = `0x${'bb'.repeat(32)}`;

const blockHash = (label: string, n: number): string =>
    `0x${(label.repeat(4) + n.toString(16).padStart(8, '0')).padEnd(64, '0')}`;
const makeLog = (fork: string, n: number, i = 0) => ({
    address,
    topics: [topic],
    data: '0x01',
    blockNumber: `0x${n.toString(16)}`,
    transactionHash: blockHash(`c${fork}`, n),
    transactionIndex: '0x0',
    blockHash: blockHash(fork, n),
    logIndex: `0x${i.toString(16)}`,
    removed: false,
});

const node = {
    head: 1000,
    fork: 'a',
    calls: {} as Record<string, number>,
    forks: {
        a: [makeLog('0', 700), makeLog('a', 950), makeLog('a', 955)],
        b: [makeLog('0', 700), makeLog('b', 952)],
    } as Record<string, ReturnType<typeof makeLog>[]>,
};
const hashAt = (n: number): string => (n <= 800 ? blockHash('0', n) : blockHash(node.fork, n));

const request = z.object({ id: z.unknown(), method: z.string(), params: z.array(z.unknown()) });
const filter = z.object({ fromBlock: z.string(), toBlock: z.string() });
const answerOf = (method: string, params: unknown[]): unknown => {
    node.calls[method] = (node.calls[method] ?? 0) + 1;
    if (method === 'eth_blockNumber') return `0x${node.head.toString(16)}`;
    if (method === 'eth_getBlockByNumber') {
        const tag = z.string().parse(params[0]);
        return { number: tag, hash: hashAt(parseInt(tag, 16)), timestamp: '0x1' };
    }
    if (method === 'eth_getLogs') {
        const { fromBlock, toBlock } = filter.parse(params[0]);
        return (node.forks[node.fork] ?? []).filter((entry) => {
            const n = parseInt(entry.blockNumber, 16);
            return n >= parseInt(fromBlock, 16) && n <= parseInt(toBlock, 16);
        });
    }
    return null;
};

const listen = (server: http.Server): Promise<number> =>
    new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

describe.skipIf(databaseUrl === undefined)('reorgs behind the cache', () => {
    let fake: http.Server;
    let proxy: ChildProcess;
    let proxyPort = 0;
    let sql: postgres.Sql;

    const rpc = async (method: string, params: unknown[]): Promise<any> => {
        const response = await fetch(`http://127.0.0.1:${proxyPort}`, {
            method: 'POST',
            body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }),
        });
        return ((await response.json()) as { result: unknown }).result;
    };
    const getLogs = async (): Promise<string[]> =>
        (
            (await rpc('eth_getLogs', [
                { address: [address], topics: [[topic]], fromBlock: '0x258', toBlock: '0x3c0' },
            ])) as { blockHash: string }[]
        ).map((entry) => entry.blockHash); // 600..960
    const hashes = (fork: string): string[] => (node.forks[fork] ?? []).map((entry) => entry.blockHash);
    const resetCalls = (): void => {
        node.calls = {};
    };
    const settle = (): Promise<void> => sleep(600);

    beforeAll(async () => {
        sql = postgres(databaseUrl ?? '', { onnotice: () => {} });
        await sql`DELETE FROM logs WHERE chain_id = ${CHAIN}`;
        await sql`DELETE FROM log_coverage WHERE chain_id = ${CHAIN}`;
        await sql`DELETE FROM log_tentative WHERE chain_id = ${CHAIN}`;
        await sql`DELETE FROM blocks WHERE chain_id = ${CHAIN}`;
        await sql`DELETE FROM transactions WHERE chain_id = ${CHAIN}`;
        await sql`DELETE FROM calls WHERE chain_id = ${CHAIN}`;
        fake = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk: Buffer) => (body += chunk.toString()));
            req.on('end', () => {
                const { id, method, params } = request.parse(JSON.parse(body));
                res.end(JSON.stringify({ jsonrpc: '2.0', id, result: answerOf(method, params) }));
            });
        });
        const fakePort = await listen(fake);
        const probe = http.createServer();
        proxyPort = await listen(probe);
        await new Promise((done) => probe.close(done));
        proxy = spawn(process.execPath, ['src/main.ts'], {
            env: {
                ...process.env,
                CHAIN_ID: String(CHAIN),
                UPSTREAM_URL: `http://127.0.0.1:${fakePort}`,
                PORT: String(proxyPort),
                DATABASE_URL: databaseUrl,
                SERVE: 'logs,blocks,txs,calls',
                FLUSH_MS: '50',
            },
            stdio: 'inherit',
        });
        await sleep(1500);
        await rpc('eth_blockNumber', []);
    });

    afterAll(async () => {
        proxy.kill('SIGTERM');
        await sleep(300);
        fake.close();
        await sql.end();
    });

    it('asks the node once when cold', async () => {
        resetCalls();
        expect(await getLogs()).toEqual(hashes('a'));
        expect(node.calls['eth_getLogs']).toBe(1);
    });

    it('same fork: only blocks after the tip reach the node, one tip check', async () => {
        await settle();
        resetCalls();
        expect(await getLogs()).toEqual(hashes('a'));
        expect(node.calls['eth_getLogs']).toBe(1);
        expect(node.calls['eth_getBlockByNumber']).toBe(1);
    });

    it('reorg: a stale tip is refused and nothing from the old fork is served', async () => {
        await settle();
        await sleep(5_200); // the tip check is remembered for 5 s
        resetCalls();
        node.fork = 'b';
        expect(await getLogs()).toEqual(hashes('b'));
        expect(node.calls['eth_getBlockByNumber']).toBe(1);
        expect(node.calls['eth_getLogs']).toBe(1);
    });

    it('near the head a block is recorded but never served', async () => {
        await settle();
        resetCalls();
        const first = await rpc('eth_getBlockByNumber', ['0x384', false]);
        const second = await rpc('eth_getBlockByNumber', ['0x384', false]);
        expect(node.calls['eth_getBlockByNumber']).toBe(2);
        expect(second.hash).toBe(first.hash);
    });

    it('once final the range is fetched once more, then served without the node', async () => {
        node.head = 2000;
        await rpc('eth_blockNumber', []);
        resetCalls();
        expect(await getLogs()).toEqual(hashes('b'));
        expect(node.calls['eth_getLogs']).toBe(1);
        await settle();
        resetCalls();
        // rows of fork a are still stored but never served
        expect(await getLogs()).toEqual(hashes('b'));
        expect(node.calls['eth_getLogs'] ?? 0).toBe(0);
    });

    it('a wider range only asks the node for the missing part', async () => {
        resetCalls();
        const wider = (await rpc('eth_getLogs', [
            { address, topics: [topic], fromBlock: '0x258', toBlock: '0x3e8' },
        ])) as { blockHash: string }[]; // 600..1000
        expect(node.calls['eth_getLogs']).toBe(1);
        expect(wider.map((entry) => entry.blockHash)).toEqual(hashes('b'));
    });
});
