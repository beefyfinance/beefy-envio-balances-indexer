import { describe, expect, it } from 'vitest';

import { advanceOrder, shortChains } from './deployments.ts';

describe('advanceOrder', () => {
    it('puts the active version first and keeps the others in order', () => {
        const deployments = [
            { version: 1, state: 'retired' },
            { version: 2, state: 'active' },
            { version: 3, state: 'building' },
        ] as const;
        expect(advanceOrder(deployments).map(({ version }) => version)).toEqual([2, 1, 3]);
    });
});

describe('shortChains', () => {
    it('names a chain missing or well behind the active version', () => {
        expect(shortChains({ 1: 100, 10: 89 }, { 1: 100, 10: 100, 8453: 5 })).toEqual(['10', '8453']);
    });

    it('accepts a close count, and chains the active version does not have', () => {
        expect(shortChains({ 1: 90, 5042: 3 }, { 1: 100 })).toEqual([]);
        expect(shortChains({ 1: 100 }, {})).toEqual([]);
    });
});
