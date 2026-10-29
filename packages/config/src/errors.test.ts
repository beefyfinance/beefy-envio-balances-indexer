import { describe, expect, it } from 'vitest';

import { describeError } from './errors.ts';

const named = (name: string, message: string, extra: Record<string, unknown> = {}): Error =>
    Object.assign(new Error(message), { name }, extra);

describe('describeError', () => {
    it('says a fixed text for the errors it knows', () => {
        expect(
            describeError(
                named('HttpRequestError', 'HTTP request failed. URL: https://rpc.example/v2/KEY', { status: 429 })
            )
        ).toBe('RPC HTTP request failed (status 429)');
        expect(describeError(named('TimeoutError', 'took too long: https://rpc.example/KEY'))).toBe(
            'request timed out'
        );
    });

    it('cuts every URL to its host, whatever the error', () => {
        const text = describeError(
            new Error('fetch https://user:pw@rpc.example/v2/KEY?apikey=KEY failed, and http://h/x')
        );
        expect(text).toBe('fetch https://rpc.example failed, and http://h');
        expect(describeError('see wss://node.example/ws/KEY')).toBe('see wss://node.example');
    });

    it('prefers a short message, keeps one line, and caps the length', () => {
        expect(
            describeError(
                named('ContractFunctionExecutionError', 'long\nDetails: https://rpc.example/KEY', {
                    shortMessage: 'reverted',
                })
            )
        ).toBe('ContractFunctionExecutionError: reverted');
        expect(describeError(new Error('a\n  b'))).toBe('a b');
        expect(describeError(new Error('x'.repeat(1000))).length).toBeLessThanOrEqual(301);
        expect(describeError({ secret: 'KEY' })).toBe('unknown error');
    });
});
