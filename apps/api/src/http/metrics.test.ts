import { describe, expect, it } from 'vitest';

import { createMetrics } from './metrics.ts';

describe('metrics', () => {
    it('renders gauges and labelled counters, skipping gauges that are unknown', () => {
        const metrics = createMetrics();
        metrics.increment('requests_total', { result: 'hit' });
        metrics.increment('requests_total', { result: 'hit' });
        metrics.increment('requests_total', { result: 'miss' });
        metrics.increment('plain_total');
        expect(metrics.render({ lag_seconds: 4, unknown_seconds: undefined })).toBe(
            [
                '# TYPE lag_seconds gauge',
                'lag_seconds 4',
                '# TYPE plain_total counter',
                'plain_total 1',
                '# TYPE requests_total counter',
                'requests_total{result="hit"} 2',
                'requests_total{result="miss"} 1',
                '',
            ].join('\n')
        );
    });

    it('escapes label values', () => {
        const metrics = createMetrics();
        metrics.increment('x_total', { path: 'a"b\\c' });
        expect(metrics.render({})).toContain('x_total{path="a\\"b\\\\c"} 1');
    });
});
