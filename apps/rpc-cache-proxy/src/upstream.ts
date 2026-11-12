import type { Answer } from './lib/rpc.ts';
import type { Stats } from './stats.ts';

export type Upstream = {
    /** One JSON-RPC call, counted under `label` (the method by default). */
    call: (method: string, params: readonly unknown[], label?: string) => Promise<Answer>;
    /** A request body forwarded as received (batches, malformed JSON). */
    raw: (body: string) => Promise<Answer>;
};

const post = async (url: string, body: string): Promise<Answer> => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    return { status: response.status, text: await response.text() };
};

export const createUpstream = (url: string, stats: Stats): Upstream => ({
    call: async (method, params, label = method) => {
        const started = performance.now();
        const answer = await post(url, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
        stats.upstreamCall(stats.method(label), performance.now() - started);
        return answer;
    },
    raw: (body) => post(url, body),
});
