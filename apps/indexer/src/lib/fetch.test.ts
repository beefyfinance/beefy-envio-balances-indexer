import { describe, expect, it } from 'vitest';

import { fetchWithRetry } from './fetch';

const answering = (...answers: (number | Error)[]) => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        seen.push(init?.signal);
        const answer = answers[seen.length - 1] ?? 200;
        if (answer instanceof Error) throw answer;
        return new Response('', { status: answer });
    }) as typeof globalThis.fetch;
    return { fetch, seen };
};

describe('fetchWithRetry', () => {
    it('retries network errors, 429 and 5xx, then succeeds', async () => {
        const { fetch, seen } = answering(new TypeError('fetch failed'), 503, 200);
        const response = await fetchWithRetry('https://api.example/x', {}, { fetch, retryDelaysMs: [0, 0] });
        expect(response.status).toBe(200);
        expect(seen).toHaveLength(3);
        // every attempt has its own timeout
        expect(seen.every((signal) => signal instanceof AbortSignal)).toBe(true);
    });

    it('does not retry a client error', async () => {
        const { fetch, seen } = answering(404);
        expect((await fetchWithRetry('https://api.example/x', {}, { fetch, retryDelaysMs: [0, 0] })).status).toBe(404);
        expect(seen).toHaveLength(1);
    });

    it('gives up after the last attempt: the last response, or the last error', async () => {
        const failing = answering(500, 500, 502);
        expect(
            (await fetchWithRetry('https://api.example/x', {}, { fetch: failing.fetch, retryDelaysMs: [0, 0] })).status
        ).toBe(502);
        const down = answering(new TypeError('a'), new TypeError('b'), new TypeError('c'));
        await expect(
            fetchWithRetry('https://api.example/x', {}, { fetch: down.fetch, retryDelaysMs: [0, 0] })
        ).rejects.toThrow('c');
    });

    it('cuts an attempt that takes too long', async () => {
        const fetch = ((_url: string | URL | Request, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
            })) as typeof globalThis.fetch;
        await expect(
            fetchWithRetry('https://api.example/x', {}, { fetch, timeoutMs: 10, retryDelaysMs: [] })
        ).rejects.toThrow('timeout');
    });
});
