/** Tests of the convention rules (conventions.js), with oxlint's RuleTester. */
import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { effectsInEffectsFiles, noWallClock, preferRemedaObject, remedaNamespace } from './conventions.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });

tester.run('prefer-remeda-object', preferRemedaObject, {
    valid: ['R.entries(x);', 'R.fromEntries(pairs);', 'Object.freeze(x);', 'other.entries(x);', 'map.keys();'],
    invalid: [
        { code: 'Object.entries(x);', errors: [{ messageId: 'object' }] },
        { code: 'Object.fromEntries(pairs);', errors: [{ messageId: 'object' }] },
        { code: "Object['keys'](x);", errors: [{ messageId: 'object' }] },
        // a reference counts as much as a call
        { code: 'const values = Object.values;', errors: [{ messageId: 'object' }] },
    ],
});

tester.run('remeda-namespace', remedaNamespace, {
    valid: ["import * as R from 'remeda';", "import { map } from 'other';"],
    invalid: [
        { code: "import { map } from 'remeda';", errors: [{ messageId: 'namespace' }] },
        { code: "import * as remeda from 'remeda';", errors: [{ messageId: 'namespace' }] },
        { code: "import R from 'remeda';", errors: [{ messageId: 'namespace' }] },
        { code: "import type { Simplify } from 'remeda';", errors: [{ messageId: 'namespace' }] },
    ],
});

tester.run('no-wall-clock', noWallClock, {
    valid: ['new Date(timestamp * 1000);', 'Date.UTC(2026, 0, 1);', 'event.block.timestamp;', 'Math.max(a, b);'],
    invalid: [
        { code: 'const now = Date.now();', errors: [{ messageId: 'clock' }] },
        { code: 'const clock = Date.now;', errors: [{ messageId: 'clock' }] },
        { code: 'new Date();', errors: [{ messageId: 'clock' }] },
        { code: 'Date();', errors: [{ messageId: 'clock' }] },
        { code: 'Math.random();', errors: [{ messageId: 'clock' }] },
        { code: 'performance.now();', errors: [{ messageId: 'clock' }] },
    ],
});

tester.run('effects-in-effects-files', effectsInEffectsFiles, {
    valid: [
        { code: 'export const e = createEffect({}, async () => 1);', filename: 'src/effects/token.effects.ts' },
        { code: 'readEffect(e);', filename: 'src/lib/registry.ts' },
    ],
    invalid: [
        {
            code: 'export const e = createEffect({}, async () => 1);',
            filename: 'src/lib/registry.ts',
            errors: [{ messageId: 'placement' }],
        },
    ],
});
