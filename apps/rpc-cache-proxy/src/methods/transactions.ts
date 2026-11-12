import { type Context, type Handler, cachedAnswer } from '../context.ts';
import { hex, num } from '../lib/encoding.ts';
import { resultOf, transactionResult } from '../lib/rpc.ts';

/** `eth_getTransactionByHash`: a stored transaction (recorded only once its block is final) comes from the cache. */
export const createTransactionHandler = ({ config, read: sql, upstream, recorder, stats }: Context): Handler => {
    const s = stats.method('eth_getTransactionByHash');
    return async (id, params) => {
        if (!config.cache) return upstream.call('eth_getTransactionByHash', params);
        const hash = String(params[0]).toLowerCase();
        if (config.serve.has('txs')) {
            const started = performance.now();
            const [row] = await sql<{ raw: string }[]>`
                SELECT raw FROM transactions WHERE chain_id = ${config.chainId} AND hash = decode(${hex(hash)}, 'hex') AND final`;
            stats.lookup(s, performance.now() - started);
            if (row !== undefined) {
                s.hit++;
                return cachedAnswer(id, row.raw);
            }
        }
        s.miss++;
        const answer = await upstream.call('eth_getTransactionByHash', params);
        const result = resultOf(answer.text);
        const transaction = transactionResult.safeParse(result);
        if (transaction.success)
            recorder.recordTransaction(
                hash,
                transaction.data.blockNumber ? num(transaction.data.blockNumber) : null,
                JSON.stringify(result)
            );
        return answer;
    };
};
