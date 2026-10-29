import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFixtureFetch } from './rpcFixtures';

/** A recorded fixture of the repository: its request is replayed from the file. */
const FIXTURE = join(process.cwd(), 'test', 'fixtures', 'rpc', '56', '010469c32fc60ae5e4cf6eab9686ef10.json');

describe('rpc fixtures', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('replays a recorded answer with the request id', async () => {
        const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
            request: { method: string; params: unknown[] };
            response: Record<string, unknown>;
        };
        const live = vi.fn<typeof fetch>();
        vi.stubGlobal('fetch', live);
        const response = await createFixtureFetch(56, 'replay')('http://rpc.invalid', {
            method: 'POST',
            body: JSON.stringify({ jsonrpc: '2.0', id: 7, ...recorded.request }),
        });
        expect(await response.json()).toEqual({ ...recorded.response, id: 7 });
        expect(live).not.toHaveBeenCalled();
    });

    it('passes anything it does not recognise through, and never replays a missing fixture', async () => {
        const live = vi.fn<typeof fetch>(async () => Response.json({ jsonrpc: '2.0', id: 1, result: '0x1' }));
        vi.stubGlobal('fetch', live);
        const fixtureFetch = createFixtureFetch(56, 'replay');
        for (const body of [
            'not json',
            '[{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[]}]',
            '{"jsonrpc":"2.0","id":{"$ne":1},"method":"eth_call","params":[]}',
            '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":"../../etc/passwd"}',
            '{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0x00"]}',
        ]) {
            await fixtureFetch('http://rpc.invalid', { method: 'POST', body });
        }
        expect(live).toHaveBeenCalledTimes(5);
        await expect(
            fixtureFetch('http://rpc.invalid', {
                method: 'POST',
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'eth_call',
                    params: [{ data: '0xdead' }, 'latest'],
                }),
            })
        ).rejects.toThrow('Missing RPC fixture');
    });
});
