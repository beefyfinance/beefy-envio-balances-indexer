/**
 * The indexer must stay per-chain: Envio only splits chains across worker processes (and `envio start --chain`
 * only starts) when no entity is shared across chains, and a shared effect cache would tie chains together again.
 * These checks read the project files as text, so they fail as soon as a change makes any of it shared.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Every `createEffect(` call in src/effects, with the text of its options up to the handler. */
const effectOptions = () =>
    readdirSync(join(root, 'src/effects'))
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .flatMap((file) =>
            read(`src/effects/${file}`)
                .split('createEffect(')
                .slice(1)
                .map((options) => ({ file, options: options.split('async')[0] ?? '' }))
        );

describe('per-chain indexing', () => {
    it('makes entities and effect caches per-chain by default', () => {
        expect(read('config.yaml')).toMatch(/^disable_default_cross_chain: true$/m);
    });

    it('shares no entity across chains', () => {
        expect(read('schema.graphql')).not.toMatch(/@crossChain/);
    });

    it('declares every effect per-chain', () => {
        const effects = effectOptions();
        expect(effects.length).toBeGreaterThan(0);
        for (const { file, options } of effects) {
            expect({ file, crossChain: /crossChain:\s*false/.test(options) }).toEqual({ file, crossChain: true });
        }
    });
});
