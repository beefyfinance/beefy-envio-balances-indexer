import { describe, expect, it } from 'vitest';

import { CHAINS, chainById, chainByKey, isChainId } from './chains.ts';

describe('chains', () => {
    it('has unique ids and keys', () => {
        expect(new Set(CHAINS.map((chain) => chain.id)).size).toBe(CHAINS.length);
        expect(new Set(CHAINS.map((chain) => chain.key)).size).toBe(CHAINS.length);
    });

    it('keeps the chains sorted by id', () => {
        const ids = CHAINS.map((chain) => chain.id);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
    });

    it('looks chains up by id and key', () => {
        expect(chainById(8453)?.key).toBe('base');
        expect(chainByKey('lisk')?.id).toBe(1135);
        expect(chainById(1234567)).toBeUndefined();
        expect(isChainId(137)).toBe(true);
        expect(isChainId(5)).toBe(false);
    });
});
