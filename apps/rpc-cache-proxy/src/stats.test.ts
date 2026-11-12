import { describe, expect, it } from 'vitest';

import { createStats } from './stats.ts';

describe('stats', () => {
    it('counts per method and reports percentiles', () => {
        let clock = 1_000;
        const stats = createStats(() => clock);
        const logs = stats.method('eth_getLogs');
        logs.requests = 3;
        logs.hit = 2;
        for (const ms of [1, 2, 3, 4, 100]) stats.lookup(logs, ms);
        stats.upstreamCall(logs, 50);
        clock += 2_000;
        const report = stats.report() as { seconds: number; methods: Record<string, Record<string, number>> };
        expect(report.seconds).toBe(2);
        expect(report.methods['eth_getLogs']).toMatchObject({
            requests: 3,
            hit: 2,
            lookups: 5,
            lookupP50: 3,
            lookupP99: 4,
            upstream: 1,
            upstreamP50: 50,
        });
    });

    it('returns the same counters for the same method', () => {
        const stats = createStats();
        expect(stats.method('eth_call')).toBe(stats.method('eth_call'));
    });

    it('keeps exact counts past the sample limit', () => {
        const stats = createStats();
        const s = stats.method('x');
        for (let i = 0; i < 25_000; i++) stats.lookup(s, 1);
        expect(s.lookup.count).toBe(25_000);
        expect(s.lookup.samples).toHaveLength(20_000);
    });
});
