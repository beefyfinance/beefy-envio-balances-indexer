/* oxlint-disable beefy/no-untagged-sql -- the cases are SQL text on purpose */
/**
 * Tests of `beefy/no-untagged-sql`, two ways:
 * - the fixtures (fixtures/valid.ts, fixtures/invalid.ts) linted by the oxlint binary with the plugin loaded from a
 *   config file, as the repo would: every `// expect: <messageId>` line is reported with that message, nothing else is;
 * - oxlint's RuleTester (`oxlint/plugins-dev`) for the options.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RuleTester } from 'oxlint/plugins-dev';
import { describe, expect, it } from 'vitest';

import plugin, { looksLikeSql } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const oxlintBin = join(here, 'node_modules', '.bin', 'oxlint');
const rule = plugin.rules['no-untagged-sql'];

/** The messageId of an oxlint message (the JSON output has the message only). */
const MESSAGE_IDS = [
    ['untaggedTemplate', /^SQL in an untagged template literal/],
    ['untaggedString', /^SQL in a string literal/],
    ['concatenation', /^SQL built by string concatenation/],
    ['stringInTag', /^String building .* interpolated into/],
    ['stringInRaw', /^String building .* passed to/],
];
const messageIdOf = (message) => MESSAGE_IDS.find(([, re]) => re.test(message))?.[0] ?? `unknown: ${message}`;

/** `line:messageId` of each diagnostic of the rule when oxlint lints `file` with `options`. */
const lint = (file, options) => {
    const dir = mkdtempSync(join(tmpdir(), 'oxlint-plugin-beefy-'));
    try {
        const config = join(dir, 'oxlintrc.json');
        writeFileSync(
            config,
            JSON.stringify({
                plugins: [],
                categories: {},
                jsPlugins: [join(here, 'index.js')],
                rules: { 'beefy/no-untagged-sql': options === undefined ? 'error' : ['error', options] },
            })
        );
        let stdout;
        try {
            stdout = execFileSync(oxlintBin, ['-c', config, '-f', 'json', file], { cwd: repoRoot, encoding: 'utf8' });
        } catch (error) {
            // Exit code 1 when there are errors: the report is still on stdout.
            stdout = error.stdout;
        }
        const { diagnostics } = JSON.parse(stdout);
        return diagnostics
            .filter((d) => d.code === 'beefy(no-untagged-sql)')
            .map((d) => `${d.labels[0].span.line}:${messageIdOf(d.message)}`)
            .sort();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
};

/** `line:messageId` of each `// expect: <id>` (that line) and `// expect-next-line: <id>` (the next one) of a fixture. */
const expectedOf = (file) =>
    readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((text, index) => {
            const sameLine = /\/\/ expect: (\w+)\s*$/.exec(text);
            if (sameLine) return [`${index + 1}:${sameLine[1]}`];
            const nextLine = /^\s*\/\/ expect-next-line: (\w+)\s*$/.exec(text);
            return nextLine ? [`${index + 2}:${nextLine[1]}`] : [];
        })
        .sort();

describe('beefy/no-untagged-sql through oxlint', () => {
    it('reports nothing in the valid fixture', () => {
        expect(lint(join(here, 'fixtures', 'valid.ts'))).toEqual([]);
    });

    it('reports exactly the marked lines of the invalid fixture', () => {
        const file = join(here, 'fixtures', 'invalid.ts');
        const expected = expectedOf(file);
        expect(expected.length).toBeGreaterThan(40);
        expect(lint(file)).toEqual(expected);
    });
});

describe('looksLikeSql', () => {
    it.each([
        'SELECT 1',
        'select a, b from t',
        '  (SELECT x FROM t)',
        '/* note */ INSERT INTO t VALUES (1)',
        'create or replace view v as select 1',
        'DROP SETTINGS PROFILE IF EXISTS p',
        'with cte as (select 1) select * from cte',
        'KILL QUERY WHERE 1',
    ])('accepts %j', (text) => {
        expect(looksLikeSql(text)).toBe(true);
    });

    it.each([
        'Select a chain from the list',
        'Insert coin',
        'Created table foo',
        'invalid SQL identifier',
        'Unable to drop the connection',
        'system is down',
        'grant me access to the repo',
        '',
    ])('rejects %j', (text) => {
        expect(looksLikeSql(text)).toBe(false);
    });
});

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });

tester.run('no-untagged-sql', rule, {
    valid: [
        // Custom tag names.
        { code: 'const q = pg`select a from t where b = ${c}`;', options: [{ tags: ['pg'] }] },
        // String literals not checked.
        { code: "const q = 'SELECT 1';", options: [{ checkStringLiterals: false }] },
        // Test files skipped when configured.
        { code: 'const q = `SELECT * FROM ${t}`;', filename: 'foo.test.ts', options: [{ ignoreTestFiles: true }] },
        {
            code: 'const q = `SELECT * FROM ${t}`;',
            filename: 'foo.integration.test.ts',
            options: [{ ignoreTestFiles: true }],
        },
        // Another raw function name: `raw` is then an ordinary call.
        { code: 'const f = raw(`x = ${y}`);', options: [{ rawFunctions: ['unsafe'] }] },
        // Imports and type positions.
        "import x from 'SELECT * FROM t';",
        "type T = 'SELECT * FROM t';",
    ],
    invalid: [
        // `sql` is not allowed once `tags` is set without it.
        {
            code: 'const q = sql`SELECT * FROM ${t}`;',
            options: [{ tags: ['pg'] }],
            errors: [{ messageId: 'untaggedTemplate' }],
        },
        // Test files are checked by default.
        {
            code: 'const q = `SELECT * FROM ${t}`;',
            filename: 'foo.test.ts',
            errors: [{ messageId: 'untaggedTemplate' }],
        },
        // Not a test file: checked even with ignoreTestFiles.
        {
            code: 'const q = `SELECT * FROM ${t}`;',
            filename: 'foo.ts',
            options: [{ ignoreTestFiles: true }],
            errors: [{ messageId: 'untaggedTemplate' }],
        },
        {
            code: 'const f = unsafe(a + b);',
            options: [{ rawFunctions: ['unsafe'] }],
            errors: [{ messageId: 'stringInRaw' }],
        },
        // One report per concatenation, not one per piece.
        { code: "const q = 'SELECT a FROM t' + ' WHERE ' + w;", errors: [{ messageId: 'concatenation' }] },
        // The location of the report (columns as oxlint's RuleTester counts them).
        {
            code: 'const q = sql`SELECT * FROM t WHERE ${a + b}`;',
            errors: [{ messageId: 'stringInTag', line: 1, column: 38, endColumn: 43 }],
        },
    ],
});
