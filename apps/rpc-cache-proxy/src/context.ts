import type { Sql } from 'postgres';

import type { Head } from './head.ts';
import type { ProxyConfig } from './lib/config.ts';
import type { Answer } from './lib/rpc.ts';
import type { Recorder } from './recorder.ts';
import type { Stats } from './stats.ts';
import type { Upstream } from './upstream.ts';

/** What every method handler needs. `read` runs the cache lookups; the recorder owns the write connection. */
export type Context = {
    config: ProxyConfig;
    read: Sql;
    upstream: Upstream;
    recorder: Recorder;
    stats: Stats;
    head: Head;
};

/** A method handler: the request's id and params in, the answer to send out. */
export type Handler = (id: unknown, params: readonly unknown[]) => Promise<Answer>;

/** An answer made of a stored result (JSON text) for the request `id`. */
export const cachedAnswer = (id: unknown, resultJson: string): Answer => ({
    status: 200,
    text: `{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":${resultJson}}`,
});
