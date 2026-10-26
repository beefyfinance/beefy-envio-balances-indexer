import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CHAINS } from './chains.ts';

// The indexer app is deployed on its own (Envio Cloud) and cannot import this package, so the two chain lists are
// kept equal by this test instead.
describe('CHAINS vs the indexer config', () => {
    it('lists the same chains, with the same keys, as apps/indexer/config.yaml', () => {
        const config = readFileSync(new URL('../../../apps/indexer/config.yaml', import.meta.url), 'utf8');
        const indexed = [...config.matchAll(/^ {2}- id: (\d+) # (\S+)$/gm)].map(([, id, key]) => ({
            id: Number(id),
            key,
        }));
        expect(indexed.length).toBeGreaterThan(0);
        expect(CHAINS.map(({ id, key }) => ({ id, key }))).toEqual([...indexed].sort((a, b) => a.id - b.id));
    });
});
