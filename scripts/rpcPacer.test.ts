import { describe, expect, it } from 'vitest';
import { classifyAnswer, createRateController, retryDelayMs } from './rpcPacer';

describe('rpc pacer', () => {
    it('classifies rate limits, transient failures and normal answers', () => {
        expect(classifyAnswer({ status: 429, text: '' })).toBe('rate-limited');
        expect(classifyAnswer({ status: 200, text: '{"error":{"code":-32005,"message":"limit"}}' })).toBe(
            'rate-limited'
        );
        expect(classifyAnswer({ status: 200, text: '{"error":{"message":"Rate limit exceeded"}}' })).toBe(
            'rate-limited'
        );
        expect(classifyAnswer({ status: 0, text: 'TypeError: fetch failed' })).toBe('transient');
        expect(classifyAnswer({ status: 502, text: '' })).toBe('transient');
        expect(
            classifyAnswer({
                status: 200,
                text: '{"error":{"code":-32603,"message":"failsafe timeout policy exceeded"}}',
            })
        ).toBe('transient');
        expect(classifyAnswer({ status: 200, text: '{"error":{"code":-32603,"message":"Internal error"}}' })).toBe(
            'internal-error'
        );
        expect(classifyAnswer({ status: 200, text: '{"result":"0x1"}' })).toBe('ok');
        // a revert is the contract's answer, not something to retry
        expect(classifyAnswer({ status: 200, text: '{"error":{"code":3,"message":"execution reverted"}}' })).toBe('ok');
    });

    it('backs off exponentially, capped, and honours Retry-After', () => {
        expect(retryDelayMs(0, null)).toBe(500);
        expect(retryDelayMs(3, null)).toBe(4_000);
        expect(retryDelayMs(20, null)).toBe(60_000);
        expect(retryDelayMs(5, '2')).toBe(2_000);
        expect(retryDelayMs(0, 'soon')).toBe(500);
    });

    it('halves the rate once per burst of rate limits and raises it after a streak of successes', () => {
        let clock = 0;
        const rate = createRateController({ initial: 8, min: 1, max: 10, now: () => clock });
        rate.onRateLimited();
        rate.onRateLimited();
        rate.onRateLimited();
        expect(rate.rate).toBe(4);
        clock += 10_000;
        rate.onRateLimited();
        expect(rate.rate).toBe(2);
        clock += 10_000;
        rate.onRateLimited();
        clock += 10_000;
        rate.onRateLimited();
        expect(rate.rate).toBe(1);
        for (let i = 0; i < 20; i++) rate.onSuccess();
        expect(rate.rate).toBe(1.5);
        for (let i = 0; i < 20 * 50; i++) rate.onSuccess();
        expect(rate.rate).toBe(10);
    });
});
