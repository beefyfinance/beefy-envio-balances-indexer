import type { Context, Handler } from '../context.ts';
import { num, sha, to0x } from '../lib/encoding.ts';
import { resultOf } from '../lib/rpc.ts';

/** `eth_call` at an explicit block: a call at a final block is answered from the cache. */
export const createCallHandler = ({ config, read: sql, upstream, recorder, stats, head }: Context): Handler => {
    const s = stats.method('eth_call');
    return async (id, params) => {
        const tag = params[1];
        if (!config.cache || typeof tag !== 'string' || !tag.startsWith('0x')) {
            s.uncacheable++;
            return upstream.call('eth_call', params);
        }
        const block = num(tag);
        const key = sha(JSON.stringify([params[0], block]));
        if (config.serve.has('calls') && head.isFinal(block)) {
            const started = performance.now();
            const [row] = await sql<{ result: Buffer }[]>`
                SELECT result FROM calls WHERE chain_id = ${config.chainId} AND key = decode(${key}, 'hex') AND final`;
            stats.lookup(s, performance.now() - started);
            if (row !== undefined) {
                s.hit++;
                return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', id, result: to0x(row.result) }) };
            }
        }
        s.miss++;
        const answer = await upstream.call('eth_call', params);
        const result = resultOf(answer.text);
        if (typeof result === 'string' && result.startsWith('0x')) recorder.recordCall(key, block, result);
        return answer;
    };
};
