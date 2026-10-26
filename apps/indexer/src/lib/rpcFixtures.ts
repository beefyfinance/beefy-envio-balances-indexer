import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Record/replay of RPC responses for unit tests.
 *
 * Under vitest, state reads are served from `test/fixtures/rpc/<chainId>/<hash>.json`; a missing
 * fixture is fetched live once and recorded. Reads pinned to a block never change; reads at
 * `latest` (token metadata, swapper config) are frozen at record time, which keeps tests
 * deterministic. Commit the files: subsequent runs (and CI) make no RPC calls at all.
 *
 * RPC_FIXTURES=off disables it (live RPC only), RPC_FIXTURES=replay fails on a missing fixture.
 */

const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'rpc');

type FixtureMode = 'off' | 'record' | 'replay';

export const getRpcFixtureMode = (): FixtureMode => {
    if (process.env.VITEST !== 'true') return 'off';
    const mode = process.env.RPC_FIXTURES;
    if (mode === 'off' || mode === 'replay') return mode;
    return 'record';
};

/** State reads, answered from the block their params name. */
const RECORDABLE_METHODS = new Set([
    'eth_call',
    'eth_getBalance',
    'eth_getCode',
    'eth_getStorageAt',
    'eth_getBlockByNumber',
]);

type JsonRpcRequest = { jsonrpc: '2.0'; id: number; method: string; params?: unknown[] };
type JsonRpcResponse = { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number; message: string } };

const isRecordableRequest = (request: JsonRpcRequest) => RECORDABLE_METHODS.has(request.method);

/** Reverts are part of the answer at that block; rate limits, timeouts, gas caps are not. */
const isReplayableResponse = (response: JsonRpcResponse) =>
    response.result !== undefined || (response.error !== undefined && /revert/i.test(response.error.message ?? ''));

const fixturePath = (chainId: number, request: JsonRpcRequest) => {
    const hash = createHash('sha256')
        .update(JSON.stringify([request.method, request.params ?? []]))
        .digest('hex')
        .slice(0, 32);
    return join(FIXTURES_DIR, String(chainId), `${hash}.json`);
};

const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

export const createFixtureFetch =
    (chainId: number, mode: Exclude<FixtureMode, 'off'>): typeof fetch =>
    async (input, init) => {
        const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
        if (!body || Array.isArray(body) || !isRecordableRequest(body as JsonRpcRequest)) {
            return fetch(input, init);
        }

        const request = body as JsonRpcRequest;
        const path = fixturePath(chainId, request);
        if (existsSync(path)) {
            const stored = JSON.parse(readFileSync(path, 'utf8')) as { response: Omit<JsonRpcResponse, 'id'> };
            return jsonResponse({ ...stored.response, id: request.id });
        }
        if (mode === 'replay') {
            throw new Error(`Missing RPC fixture ${path} for ${request.method} ${JSON.stringify(request.params)}`);
        }

        const live = await fetch(input, init);
        if (!live.ok) return live;
        const response = (await live.clone().json()) as JsonRpcResponse;
        if (isReplayableResponse(response)) {
            const { id: _id, ...stored } = response;
            mkdirSync(join(FIXTURES_DIR, String(chainId)), { recursive: true });
            // write-then-rename: test files run in parallel workers
            const tmpPath = `${path}.${process.pid}.tmp`;
            writeFileSync(
                tmpPath,
                `${JSON.stringify({ request: { method: request.method, params: request.params }, response: stored })}\n`
            );
            renameSync(tmpPath, path);
        }
        return live;
    };
