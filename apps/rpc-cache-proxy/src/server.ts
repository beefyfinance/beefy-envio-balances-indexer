import http from 'node:http';

import { describeError } from '@beefy/config';

import type { Context, Handler } from './context.ts';
import { log } from './lib/log.ts';
import { type Answer, requestSchema, parseJson, withId } from './lib/rpc.ts';
import { createBlockHandler } from './methods/blocks.ts';
import { createCallHandler } from './methods/calls.ts';
import { createLogsHandler } from './methods/logs.ts';
import { createTransactionHandler } from './methods/transactions.ts';

/** Routes one request body to the handler of its method; batches, malformed bodies and other methods go to the node as received. */
export const createRouter = (context: Context): ((body: string) => Promise<Answer>) => {
    const { upstream, stats, head } = context;
    const handlers = new Map<string, Handler>([
        ['eth_getLogs', createLogsHandler(context)],
        ['eth_getBlockByNumber', createBlockHandler(context)],
        ['eth_getTransactionByHash', createTransactionHandler(context)],
        ['eth_call', createCallHandler(context)],
    ]);
    return async (body) => {
        const request = requestSchema.safeParse(parseJson(body));
        if (!request.success) {
            stats.method('(batch)').requests++;
            return upstream.raw(body);
        }
        const { id, method, params } = request.data;
        stats.method(method).requests++;
        const handler = handlers.get(method);
        if (handler !== undefined) return handler(id, params);
        const forwarded = await upstream.call(method, params);
        if (method === 'eth_blockNumber') head.observe(forwarded.text);
        return { status: forwarded.status, text: withId(forwarded.text, id) };
    };
};

/** A loopback HTTP server: POST is JSON-RPC, GET /stats the counters, GET /health liveness. */
export const createServer = (context: Context): http.Server => {
    const route = createRouter(context);
    return http.createServer((req, res) => {
        if (req.method === 'GET') {
            res.writeHead(req.url === '/stats' || req.url === '/health' ? 200 : 404, {
                'content-type': 'application/json',
            });
            res.end(
                JSON.stringify(
                    req.url === '/stats'
                        ? context.stats.report()
                        : req.url === '/health'
                          ? { ok: true }
                          : { error: 'not found' }
                )
            );
            return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            route(body)
                .then(({ status, text }) => {
                    const id: unknown = requestSchema.safeParse(parseJson(body)).data?.id;
                    res.writeHead(status, { 'content-type': 'application/json' });
                    res.end(id === undefined ? text : withId(text, id));
                })
                .catch((error: unknown) => {
                    log.warn(
                        { event: 'request-failed', error: describeError(error).slice(0, 200) },
                        'a request failed'
                    );
                    res.writeHead(502, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ error: describeError(error).slice(0, 200) }));
                });
        });
    });
};
