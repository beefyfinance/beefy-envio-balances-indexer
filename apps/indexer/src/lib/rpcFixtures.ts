import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import type { RpcFixtureMode } from './config';

/**
 * Record/replay of RPC responses for unit tests.
 *
 * Under vitest, state reads are served from `test/fixtures/rpc/<chainId>/<hash>.json`; a missing
 * fixture is fetched live once and recorded. Reads pinned to a block never change; reads at
 * `latest` (token metadata, swapper config) are frozen at record time, which keeps tests
 * deterministic. Commit the files: subsequent runs (and CI) make no RPC calls at all.
 *
 * The mode comes from RPC_FIXTURES (src/lib/config.ts): `off` disables it (live RPC only), `replay` fails on a
 * missing fixture. Request bodies, fixture files and live answers are validated: anything unexpected is passed
 * through (requests) or neither replayed nor recorded (files, answers).
 */

const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'rpc');

/** State reads, answered from the block their params name. */
const RECORDABLE_METHODS = new Set([
    'eth_call',
    'eth_getBalance',
    'eth_getCode',
    'eth_getStorageAt',
    'eth_getBlockByNumber',
]);

const requestSchema = z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.number(), z.string()]),
    method: z.string(),
    params: z.array(z.unknown()).optional(),
});
type JsonRpcRequest = z.infer<typeof requestSchema>;

const errorSchema = z.object({ code: z.number(), message: z.string() });

/** A stored answer: a result, or an error (a revert). */
const storedResponseSchema = z.union([
    z.object({ jsonrpc: z.literal('2.0'), result: z.unknown().refine((value) => value !== undefined) }),
    z.object({ jsonrpc: z.literal('2.0'), error: errorSchema }),
]);
type StoredResponse = z.infer<typeof storedResponseSchema>;

const fixtureSchema = z.object({ response: storedResponseSchema });

/** Reverts are part of the answer at that block; rate limits, timeouts, gas caps are not. */
const isReplayable = (response: StoredResponse) => !('error' in response) || /revert/i.test(response.error.message);

/** Undefined for anything that is not valid JSON. */
const parseJson = (text: string): unknown => {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
};

const fixturePath = (chainId: number, request: JsonRpcRequest) => {
    const hash = createHash('sha256')
        .update(JSON.stringify([request.method, request.params ?? []]))
        .digest('hex')
        .slice(0, 32);
    return join(FIXTURES_DIR, String(chainId), `${hash}.json`);
};

const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** The stored answer at `path`; a file that does not parse is an error (fix or delete it), not a silent miss. */
const readFixture = (path: string): StoredResponse => {
    const parsed = fixtureSchema.safeParse(parseJson(readFileSync(path, 'utf8')));
    if (!parsed.success) throw new Error(`Invalid RPC fixture ${path}: ${parsed.error.message}`);
    return parsed.data.response;
};

export const createFixtureFetch =
    (chainId: number, mode: Exclude<RpcFixtureMode, 'off'>): typeof fetch =>
    async (input, init) => {
        const parsed =
            typeof init?.body === 'string'
                ? requestSchema.safeParse(parseJson(init.body))
                : { success: false as const };
        if (!parsed.success || !RECORDABLE_METHODS.has(parsed.data.method)) {
            return fetch(input, init);
        }

        const request = parsed.data;
        const path = fixturePath(chainId, request);
        if (existsSync(path)) {
            return jsonResponse({ ...readFixture(path), id: request.id });
        }
        if (mode === 'replay') {
            throw new Error(`Missing RPC fixture ${path} for ${request.method} ${JSON.stringify(request.params)}`);
        }

        const live = await fetch(input, init);
        if (!live.ok) return live;
        const response = storedResponseSchema.safeParse(parseJson(await live.clone().text()));
        if (response.success && isReplayable(response.data)) {
            mkdirSync(join(FIXTURES_DIR, String(chainId)), { recursive: true });
            // write-then-rename: test files run in parallel workers
            const tmpPath = `${path}.${process.pid}.tmp`;
            writeFileSync(
                tmpPath,
                `${JSON.stringify({ request: { method: request.method, params: request.params }, response: response.data })}\n`
            );
            renameSync(tmpPath, path);
        }
        return live;
    };
