import { describe, expect, it } from 'vitest';

import { cleanLog, filterSchema, logsResult, parseJson, requestSchema, resultOf, withId } from './rpc.ts';

const log = {
    address: '0xaa',
    topics: ['0xbb'],
    data: '0x01',
    blockNumber: '0x1',
    transactionHash: '0xcc',
    transactionIndex: '0x0',
    blockHash: '0xdd',
    logIndex: '0x0',
    extra: 'dropped',
};

describe('rpc helpers', () => {
    it('parses JSON without throwing', () => {
        expect(parseJson('{"a":1}')).toEqual({ a: 1 });
        expect(parseJson('nope')).toBeUndefined();
    });

    it('accepts one request and rejects a batch', () => {
        expect(requestSchema.safeParse({ id: 1, method: 'eth_call', params: [1] }).success).toBe(true);
        expect(requestSchema.safeParse([{ id: 1, method: 'eth_call' }]).success).toBe(false);
        expect(requestSchema.parse({ id: 1, method: 'eth_chainId' }).params).toEqual([]);
    });

    it('reads the result of an answer', () => {
        expect(resultOf('{"jsonrpc":"2.0","id":1,"result":"0x5"}')).toBe('0x5');
        expect(resultOf('{"error":{}}')).toBeUndefined();
        expect(resultOf('garbage')).toBeUndefined();
    });

    it('rewrites the id only when it differs', () => {
        const text = '{"jsonrpc":"2.0","id":1,"result":null}';
        expect(withId(text, 1)).toBe(text);
        expect(parseJson(withId(text, 'abc'))).toEqual({ jsonrpc: '2.0', id: 'abc', result: null });
    });

    it('keeps only the fields of a log the indexer reads', () => {
        expect(logsResult.parse([log]).map(cleanLog)).toEqual([{ ...log, extra: undefined, removed: false }]);
    });

    it('rejects a log answer that is not logs', () => {
        expect(logsResult.safeParse([{ foo: 1 }]).success).toBe(false);
        expect(logsResult.safeParse(null).success).toBe(false);
    });

    it('reads a log filter with a topic list per slot', () => {
        const filter = filterSchema.parse({
            address: ['0x1'],
            topics: [['0xa', '0xb'], null],
            fromBlock: '0x1',
            toBlock: '0x2',
            fromTip: 'kept',
        });
        expect(filter.topics).toEqual([['0xa', '0xb'], null]);
        expect(filter).toMatchObject({ fromTip: 'kept' });
    });
});
