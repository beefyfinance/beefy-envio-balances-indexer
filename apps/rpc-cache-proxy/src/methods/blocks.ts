import { type Context, type Handler, cachedAnswer } from '../context.ts';
import { num } from '../lib/encoding.ts';
import { blockResult, resultOf } from '../lib/rpc.ts';

/** `eth_getBlockByNumber`: a final block with its serving flag on comes from the cache, the rest from the node. */
export const createBlockHandler = ({ config, read: sql, upstream, recorder, stats, head }: Context): Handler => {
    const s = stats.method('eth_getBlockByNumber');
    return async (id, params) => {
        const tag = params[0];
        if (!config.cache || typeof tag !== 'string' || !tag.startsWith('0x')) {
            s.uncacheable++;
            return upstream.call('eth_getBlockByNumber', params);
        }
        const number = num(tag);
        const full = params[1] === true;
        if (config.serve.has('blocks') && head.isFinal(number)) {
            const started = performance.now();
            const [row] = await sql<{ raw: string }[]>`
                SELECT raw FROM blocks WHERE chain_id = ${config.chainId} AND number = ${number} AND full_txs = ${full} AND final`;
            stats.lookup(s, performance.now() - started);
            if (row !== undefined) {
                s.hit++;
                return cachedAnswer(id, row.raw);
            }
        }
        s.miss++;
        const answer = await upstream.call('eth_getBlockByNumber', params);
        const result = resultOf(answer.text);
        const block = blockResult.safeParse(result);
        if (block.success) recorder.recordBlock(number, full, block.data.hash ?? null, JSON.stringify(result));
        return answer;
    };
};
