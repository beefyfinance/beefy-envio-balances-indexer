import { describeError } from '@beefy/config';

import { num } from './lib/encoding.ts';
import { log } from './lib/log.ts';
import { resultOf } from './lib/rpc.ts';
import type { Upstream } from './upstream.ts';

export type Head = {
    value: () => number;
    /** A block at least `depth` below the highest block seen: it will not be reorged. */
    isFinal: (block: number) => boolean;
    /** Records an `eth_blockNumber` answer seen on the way. */
    observe: (answerText: string) => void;
    refresh: () => Promise<void>;
};

export const createHead = (upstream: Upstream, depth: number): Head => {
    let head = 0;
    const observe = (answerText: string): void => {
        const result = resultOf(answerText);
        if (typeof result === 'string' && /^0x[0-9a-f]+$/i.test(result)) head = Math.max(head, num(result));
    };
    return {
        value: () => head,
        isFinal: (block) => head > 0 && block <= head - depth,
        observe,
        refresh: async () => {
            try {
                observe((await upstream.call('eth_blockNumber', [], 'head-refresh')).text);
            } catch (error) {
                log.warn({ event: 'head-refresh-failed', error: describeError(error) }, 'could not read the head');
            }
        },
    };
};
