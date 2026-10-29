/**
 * Local oxlint JS plugin (ESLint-compatible API, see https://oxc.rs/docs/guide/usage/linter/js-plugins.html).
 *
 * Rule `beefy/no-untagged-sql`: SQL is only built with the typed `sql` tagged template (and its helpers). The rule is
 * syntactic: it flags SQL-looking text that is not inside an allowed tag (template literals, string literals,
 * concatenation with `+`, `.concat()` and `[...].join()`), and, inside an allowed tag, string building used directly as
 * an interpolated expression. It cannot see through variables: a string built elsewhere and passed to `raw()` is
 * caught only when the building itself looks like SQL.
 *
 * The other rules (remeda, no wall clock, effects placement) are in conventions.js.
 */

import { effectsInEffectsFiles, noWallClock, preferRemedaObject, remedaNamespace } from './conventions.js';

/** Text standing in for a `${}` expression when the static parts of a template are tested. */
const HOLE = ' __hole__ ';

/**
 * Statement starts, tested at the start of the text (after whitespace, `(`, `,` and SQL comments), in any case. Each
 * is a keyword pair or a keyword plus structure, so prose that starts with one word ("Select a chain") does not match.
 */
const STATEMENT_START_ANY_CASE = [
    // `select <column>[,| as| from]`: "Select a chain from the list" does not match.
    /^select\s+(distinct\s+)?(\*|__hole__|[\w.`"]+(\([^)]*\))?)\s*(,|\bas\s|\bfrom\s)/i,
    /^insert\s+into\s/i,
    /^(create|attach)\s+(or\s+replace\s+)?(temporary\s+)?(table|view|materialized\s+view|live\s+view|database|user|settings\s+profile|role|row\s+policy|quota|dictionary|function)\b/i,
    /^alter\s+(table|user|role|settings\s+profile|database|view|quota|row\s+policy)\s/i,
    /^drop\s+(temporary\s+)?(table|view|database|user|role|settings\s+profile|dictionary|function|row\s+policy|quota)\s/i,
    /^exchange\s+tables\s/i,
    /^rename\s+(table|database|dictionary)\s/i,
    /^truncate\s+table\s/i,
    /^optimize\s+table\s/i,
    /^with\s+[\w`"]+\s+as\s*\(/i,
    /^detach\s+(table|view|database|dictionary)\s/i,
];

/** Statement starts that read as prose in lower case: upper case only, at the start of the text. */
const STATEMENT_START_UPPER = [
    /^SELECT\s/,
    /^TRUNCATE\s/,
    /^(GRANT|REVOKE)\s[\s\S]*\s(ON|TO|FROM)\s/,
    /^SYSTEM\s+(FLUSH|RELOAD|DROP|STOP|START|SYNC|RESTART|RESTORE|UNFREEZE)\b/,
    /^UPDATE\s+\S+\s+SET\s/,
    /^DELETE\s+FROM\s/,
    /^SHOW\s+(CREATE|TABLES|DATABASES|GRANTS|USERS|ROLES|SETTINGS|PROCESSLIST)\b/,
    /^(DESCRIBE|DESC)\s+TABLE\s/,
    /^KILL\s+(QUERY|MUTATION)\s/,
    /^EXPLAIN\s/,
    /^SET\s+(ROLE|DEFAULT\s+ROLE)\s/,
    /^CHECK\s+TABLE\s/,
];

/**
 * Fragments of a statement (a clause, a CTE, a column definition), upper case only, at the start of the text and
 * followed by more text: what hand-built SQL is assembled from.
 */
const FRAGMENT_START_UPPER = [
    /^(WHERE|PREWHERE|HAVING|QUALIFY)\s+\S/,
    /^(AND|OR)\s+(NOT\s+)?[\w`"(]/,
    /^(ORDER|GROUP|PARTITION|PRIMARY\s+KEY|SAMPLE)\s+BY\s/,
    /^(ORDER|GROUP|PARTITION)\s+BY\s/,
    /^LIMIT\s+(\d|__hole__|\{)/,
    /^((LEFT|RIGHT|INNER|FULL|CROSS|ANY|ALL|ASOF|SEMI|ANTI|ARRAY|GLOBAL)\s+)*(OUTER\s+)?JOIN\s/,
    /^UNION\s+(ALL|DISTINCT)\s/,
    /^SETTINGS\s+\w+\s*=/,
    /^ENGINE\s*=\s*\w/,
    /^FORMAT\s+(JSON|TabSeparated|CSV|Arrow|Native|Null|Pretty)/,
    /^FROM\s+[\w`"]/,
    /^VALUES\s*\(/,
    /^[\w`"]+\s+AS\s*\(\s*(SELECT|WITH)\b/,
    /^[\w`"]+\s+AS\s*\(\s*$/,
];

/** Strong signals anywhere in the text, upper case only. */
const ANYWHERE_UPPER = [
    /\bSELECT\s[\s\S]*?\bFROM\s+[\w`"({]/,
    /\bINSERT\s+INTO\s+[\w`"]/,
    /\bCREATE\s+(OR\s+REPLACE\s+)?(TEMPORARY\s+)?(TABLE|VIEW|MATERIALIZED\s+VIEW|DATABASE|USER|ROLE|SETTINGS\s+PROFILE|DICTIONARY)\s/,
    /\bALTER\s+TABLE\s/,
    /\bDROP\s+(TABLE|VIEW|DATABASE|USER|ROLE|DICTIONARY|SETTINGS\s+PROFILE)\s/,
    /\bEXCHANGE\s+TABLES\s/,
    /\bRENAME\s+TABLE\s/,
    /\bOPTIMIZE\s+TABLE\s/,
    /\bTRUNCATE\s+TABLE\s/,
    // `x AS t LEFT ANTI JOIN y AS l ON …`
    /\b((LEFT|RIGHT|INNER|FULL|CROSS|ANY|ALL|ASOF|SEMI|ANTI|ARRAY|GLOBAL|OUTER)\s+)*JOIN\s+[\w`".]+(\s+AS\s+[\w`"]+)?\s+(ON|USING)\s/,
    // A ClickHouse query parameter (`{name:Type}`) or a psql variable (`:'name'`, `:"name"`): only SQL has these.
    /\{\w+:\s*[A-Z]\w*(\([^{}]*\))?\}/,
    /(^|[\s(=,]):['"]\w+['"]/,
];

/** A separator or a lone keyword that only makes sense between pieces of SQL (`.join(' AND ')`, `a + ' WHERE ' + b`). */
const KEYWORD_ONLY_UPPER =
    /^(WHERE|PREWHERE|AND|OR|HAVING|FROM|ORDER BY|GROUP BY|LIMIT|OFFSET|UNION ALL|UNION DISTINCT|SETTINGS|FORMAT|JOIN|LEFT JOIN|INNER JOIN|ON|USING|VALUES|SELECT|WITH|AS|FINAL|IN|NOT IN)$/;

const stripLeading = (text) => {
    let rest = text;
    for (;;) {
        const next = rest
            .replace(/^[\s(,;]+/, '')
            .replace(/^--[^\n]*(\n|$)/, '')
            .replace(/^\/\*[\s\S]*?\*\//, '');
        if (next === rest) return rest;
        rest = next;
    }
};

/**
 * Whether `text` looks like SQL.
 * - `anywhere`: also look for strong upper-case signals (`SELECT … FROM`, `CREATE TABLE`) past the start. Used for
 *   templates, not for string literals, where they are mostly injection payloads in tests (`"x'; DROP TABLE t; --"`).
 * - `fragments`: also accept a clause start (`WHERE …`, `LIMIT 10`, `name AS (`). Not for a lone string literal, which
 *   is then mostly text a test looks for; a fragment is still caught as a piece of a concatenation.
 */
export const looksLikeSql = (text, { anywhere = true, fragments = true } = {}) => {
    const start = stripLeading(text);
    // `${head}SELECT …`: the statement starts after a leading expression.
    const afterHoles = stripLeading(start.replace(/^(\s*__hole__\s*)+/, ''));
    const startsLikeSql = (candidate) =>
        STATEMENT_START_ANY_CASE.some((re) => re.test(candidate)) ||
        STATEMENT_START_UPPER.some((re) => re.test(candidate)) ||
        (fragments && FRAGMENT_START_UPPER.some((re) => re.test(candidate)));
    return (
        startsLikeSql(start) || startsLikeSql(afterHoles) || (anywhere && ANYWHERE_UPPER.some((re) => re.test(text)))
    );
};

/** Whether `text` is a lone SQL keyword, used as a separator or a piece between other pieces. */
export const isSqlKeywordPiece = (text) => KEYWORD_ONLY_UPPER.test(text.trim().replace(/\s+/g, ' '));

const templateText = (quasi) => quasi.quasis.map((element) => element.value.cooked ?? element.value.raw).join(HOLE);

const isStringLiteral = (node) => node?.type === 'Literal' && typeof node.value === 'string';

/** Strips the wrappers that do not change what an expression is (`(x)`, `x as T`, `x!`, `x satisfies T`). */
const unwrap = (node) => {
    let current = node;
    while (
        current &&
        (current.type === 'TSAsExpression' ||
            current.type === 'TSSatisfiesExpression' ||
            current.type === 'TSNonNullExpression' ||
            current.type === 'TSTypeAssertion' ||
            current.type === 'ParenthesizedExpression')
    ) {
        current = current.expression;
    }
    return current;
};

const memberName = (callee) => {
    const node = unwrap(callee);
    if (node?.type !== 'MemberExpression' || node.computed) return undefined;
    return node.property.type === 'Identifier' ? node.property.name : undefined;
};

const calleeName = (callee) => {
    const node = unwrap(callee);
    if (node?.type === 'Identifier') return node.name;
    return memberName(node);
};

/** The name a tag is called by: `sql`, `db.sql` → `sql`, `sql<Row>` (type arguments are not part of the tag node). */
const tagName = (tag) => calleeName(tag);

const isStringConcat = (node) => node?.type === 'BinaryExpression' && node.operator === '+';
const isConcatCall = (node) => node?.type === 'CallExpression' && memberName(node.callee) === 'concat';
const isJoinCall = (node) =>
    node?.type === 'CallExpression' &&
    memberName(node.callee) === 'join' &&
    unwrap(unwrap(node.callee).object)?.type === 'ArrayExpression';

/** The operands of a `+` chain, flattened: `a + b + c` → [a, b, c]. */
const plusOperands = (node) => {
    const target = unwrap(node);
    if (!isStringConcat(target)) return [target];
    return [...plusOperands(target.left), ...plusOperands(target.right)];
};

/**
 * Methods whose arguments are text looked for or compared with, not SQL being built: test matchers
 * (`expect(sql).toContain('LIMIT 1 BY')`) and string searches (`sql.indexOf('WHERE x')`).
 */
const READING_METHODS = new Set([
    'includes',
    'indexOf',
    'lastIndexOf',
    'startsWith',
    'endsWith',
    'split',
    'match',
    'matchAll',
    'search',
    'replace',
    'replaceAll',
]);
const isMatcher = (name) => /^to[A-Z]/.test(name);

/** Whether a literal is an argument of a matcher or a string search (see {@link READING_METHODS}). */
const isReadingText = (node) => {
    const parent = node.parent;
    if (parent?.type !== 'CallExpression' || !parent.arguments.includes(node)) return false;
    const name = memberName(parent.callee);
    return name !== undefined && (READING_METHODS.has(name) || isMatcher(name));
};

const DEFAULT_OPTIONS = {
    tags: ['sql', 'pgSql'],
    rawFunctions: ['raw'],
    checkStringLiterals: true,
    ignoreTestFiles: false,
    testFilePattern: '\\.(test|spec|integration\\.test)\\.[cm]?[jt]sx?$',
};

const rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Build SQL only with an allowed tagged template (`sql`): no untagged SQL text, no string concatenation of SQL, no string building inside the tag.',
        },
        schema: [
            {
                type: 'object',
                properties: {
                    tags: { type: 'array', items: { type: 'string' } },
                    rawFunctions: { type: 'array', items: { type: 'string' } },
                    checkStringLiterals: { type: 'boolean' },
                    ignoreTestFiles: { type: 'boolean' },
                    testFilePattern: { type: 'string' },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            untaggedTemplate: 'SQL in an untagged template literal: use the `{{tags}}` tagged template.',
            untaggedString: 'SQL in a string literal: use the `{{tags}}` tagged template.',
            concatenation: 'SQL built by string concatenation ({{how}}): compose `{{tags}}` fragments (join(), etc.).',
            stringInTag:
                'String building ({{how}}) interpolated into `{{tag}}`: interpolate a `{{tag}}` fragment or a helper (ident(), param.*) instead.',
            stringInRaw:
                'String building ({{how}}) passed to `{{fn}}()`: build the fragment with the `{{tags}}` tagged template instead.',
        },
    },
    create(context) {
        const options = { ...DEFAULT_OPTIONS, ...context.options?.[0] };
        const filename = context.filename ?? context.getFilename?.() ?? '';
        if (options.ignoreTestFiles && new RegExp(options.testFilePattern).test(filename)) return {};
        const tags = new Set(options.tags);
        const rawFunctions = new Set(options.rawFunctions);
        const tagList = options.tags.join('` or `');

        /** How a node builds a string, when it does: '+', '.concat()', '[].join()', 'template'; else undefined. */
        const stringBuilding = (expression) => {
            const node = unwrap(expression);
            if (node?.type === 'TemplateLiteral' && node.expressions.length > 0) return 'interpolated template';
            if (isStringConcat(node)) return '+';
            if (isConcatCall(node)) return '.concat()';
            // Any `.join()`: Array.prototype.join makes a string (the typed helper is a plain `join(…)` call).
            if (node?.type === 'CallExpression' && memberName(node.callee) === 'join') return '.join()';
            return undefined;
        };

        const isAllowedTagged = (templateLiteral) => {
            const parent = templateLiteral.parent;
            return (
                parent?.type === 'TaggedTemplateExpression' &&
                parent.quasi === templateLiteral &&
                tags.has(tagName(parent.tag))
            );
        };

        /** Whether a piece of a concatenation (a string literal or a template) is SQL text or a lone SQL keyword. */
        const sqlPiece = (piece) => {
            const node = unwrap(piece);
            if (isStringLiteral(node))
                return looksLikeSql(node.value, { anywhere: false }) || isSqlKeywordPiece(node.value);
            if (node?.type === 'TemplateLiteral' && !isAllowedTagged(node)) {
                const text = templateText(node);
                return looksLikeSql(text) || (node.expressions.length === 0 && isSqlKeywordPiece(text));
            }
            return false;
        };

        /**
         * Nodes reported as part of a concatenation or of a tag's expression: their own text is not reported again.
         * Template and string literals are reported at the end of the file (`deferred`), once all of these are known.
         */
        const reported = new WeakSet();
        const deferred = [];
        const markPieces = (pieces) => {
            for (const piece of pieces) if (piece) reported.add(unwrap(piece));
        };

        const reportConcatenation = (node, pieces, how) => {
            if (reported.has(node) || !pieces.some(sqlPiece)) return;
            markPieces(pieces);
            context.report({ node, messageId: 'concatenation', data: { how, tags: tagList } });
        };

        return {
            BinaryExpression(node) {
                if (node.operator !== '+') return;
                // Report the outermost `+` of a chain only.
                const parent = node.parent?.type === 'ParenthesizedExpression' ? node.parent.parent : node.parent;
                if (isStringConcat(parent)) return;
                reportConcatenation(node, plusOperands(node), '+');
            },
            CallExpression(node) {
                if (isConcatCall(node)) {
                    const callee = unwrap(node.callee);
                    reportConcatenation(node, [callee.object, ...node.arguments], '.concat()');
                    return;
                }
                if (isJoinCall(node)) {
                    const array = unwrap(unwrap(node.callee).object);
                    reportConcatenation(node, [...array.elements, ...node.arguments], '[].join()');
                    return;
                }
                if (memberName(node.callee) === 'join' && node.arguments[0] && !reported.has(node)) {
                    // `parts.join(' AND ')`: the array is not visible, the separator says it is SQL.
                    const separator = unwrap(node.arguments[0]);
                    if (sqlPiece(separator)) {
                        markPieces([separator]);
                        context.report({ node, messageId: 'concatenation', data: { how: '.join()', tags: tagList } });
                    }
                    return;
                }
                const name = calleeName(node.callee);
                if (name && rawFunctions.has(name) && node.arguments[0]) {
                    const how = stringBuilding(node.arguments[0]);
                    if (how)
                        context.report({
                            node: node.arguments[0],
                            messageId: 'stringInRaw',
                            data: { how, fn: name, tags: tagList },
                        });
                }
            },
            TaggedTemplateExpression(node) {
                const name = tagName(node.tag);
                if (!tags.has(name)) return;
                for (const expression of node.quasi.expressions) {
                    const how = stringBuilding(expression);
                    if (how) {
                        reported.add(unwrap(expression));
                        context.report({ node: expression, messageId: 'stringInTag', data: { how, tag: name } });
                    }
                }
            },
            'Program:exit'() {
                for (const node of deferred) {
                    if (reported.has(node)) continue;
                    const messageId = node.type === 'TemplateLiteral' ? 'untaggedTemplate' : 'untaggedString';
                    context.report({ node, messageId, data: { tags: tagList } });
                }
            },
            TemplateLiteral(node) {
                if (isAllowedTagged(node)) return;
                // Another tag (String.raw, gql, a test helper's): not SQL by construction unless its text says so.
                if (isReadingText(node) || !looksLikeSql(templateText(node))) return;
                deferred.push(node);
            },
            Literal(node) {
                if (!options.checkStringLiterals || typeof node.value !== 'string') return;
                const parent = node.parent;
                if (
                    parent?.type === 'ImportDeclaration' ||
                    parent?.type === 'ExportNamedDeclaration' ||
                    parent?.type === 'ExportAllDeclaration' ||
                    parent?.type === 'ImportExpression' ||
                    parent?.type === 'TSLiteralType' ||
                    parent?.type === 'TSExternalModuleReference' ||
                    (parent?.type === 'ExpressionStatement' && parent.directive)
                ) {
                    return;
                }
                if (isReadingText(node) || !looksLikeSql(node.value, { anywhere: false, fragments: false })) return;
                deferred.push(node);
            },
        };
    },
};

export default {
    meta: { name: 'beefy' },
    rules: {
        'no-untagged-sql': rule,
        'prefer-remeda-object': preferRemedaObject,
        'remeda-namespace': remedaNamespace,
        'no-wall-clock': noWallClock,
        'effects-in-effects-files': effectsInEffectsFiles,
    },
};
