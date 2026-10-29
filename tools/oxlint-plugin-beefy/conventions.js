/**
 * The repo's conventions that oxlint's own rules cannot express. Each is syntactic, and scoped to files by the
 * `overrides` of .oxlintrc.json rather than by options.
 */

/** `a.b` (or `a['b']`) where `a` is the global `object` and `b` one of `properties`, else undefined. */
const staticMember = (node, object, properties) => {
    if (node?.type !== 'MemberExpression' || node.object.type !== 'Identifier' || node.object.name !== object) return;
    const name = node.computed
        ? node.property.type === 'Literal' && typeof node.property.value === 'string'
            ? node.property.value
            : undefined
        : node.property.name;
    return properties.has(name) ? name : undefined;
};

const OBJECT_HELPERS = new Map([
    ['entries', 'R.entries'],
    ['fromEntries', 'R.fromEntries'],
    ['keys', 'R.keys'],
    ['values', 'R.values'],
]);

/** `Object.entries` and friends lose the key types; remeda's keep them. */
export const preferRemedaObject = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Use `R.entries`, `R.fromEntries`, `R.keys` and `R.values` instead of the `Object` ones.',
        },
        schema: [],
        messages: { object: '`Object.{{name}}` loses the key types: use `{{remeda}}`.' },
    },
    create(context) {
        const helpers = new Set(OBJECT_HELPERS.keys());
        return {
            MemberExpression(node) {
                const name = staticMember(node, 'Object', helpers);
                if (name)
                    context.report({ node, messageId: 'object', data: { name, remeda: OBJECT_HELPERS.get(name) } });
            },
        };
    },
};

/** remeda is imported one way only, so every module reads the same: `R.pipe(...)`, `R.map(...)`. */
export const remedaNamespace = {
    meta: {
        type: 'suggestion',
        docs: { description: "Import remeda as `import * as R from 'remeda'`." },
        schema: [],
        messages: { namespace: "Import remeda as `import * as R from 'remeda'`." },
    },
    create(context) {
        return {
            ImportDeclaration(node) {
                if (node.source.value !== 'remeda') return;
                const [only, ...rest] = node.specifiers;
                const namespace = only?.type === 'ImportNamespaceSpecifier' && only.local.name === 'R';
                if (!namespace || rest.length > 0) context.report({ node, messageId: 'namespace' });
            },
        };
    },
};

const DATE_NOW = new Set(['now']);
const MATH_RANDOM = new Set(['random']);
const PERFORMANCE_NOW = new Set(['now']);

/**
 * Handlers are replayed (reorgs, resyncs) and must write the same rows each time: what they read comes from the event,
 * the store and effects, never from the clock or a random source.
 */
export const noWallClock = {
    meta: {
        type: 'problem',
        docs: {
            description: 'No wall clock or randomness (`Date.now`, `new Date()`, `Math.random`, `performance.now`).',
        },
        schema: [],
        messages: {
            clock: '`{{what}}` makes the output depend on when it runs: derive it from the event (block timestamp, number).',
        },
    },
    create(context) {
        const report = (node, what) => context.report({ node, messageId: 'clock', data: { what } });
        const isDate = (callee) => callee.type === 'Identifier' && callee.name === 'Date';
        return {
            MemberExpression(node) {
                if (staticMember(node, 'Date', DATE_NOW)) report(node, 'Date.now');
                else if (staticMember(node, 'Math', MATH_RANDOM)) report(node, 'Math.random');
                else if (staticMember(node, 'performance', PERFORMANCE_NOW)) report(node, 'performance.now');
            },
            // a date of a given time is fine, the current one is not
            NewExpression(node) {
                if (isDate(node.callee) && node.arguments.length === 0) report(node, 'new Date()');
            },
            CallExpression(node) {
                if (isDate(node.callee)) report(node, 'Date()');
            },
        };
    },
};

const EFFECTS_FILE = /\.effects\.[cm]?[jt]s$/;

/** Effects live in `*.effects.ts`: what reaches outside the store (RPC, HTTP) is found in one kind of file. */
export const effectsInEffectsFiles = {
    meta: {
        type: 'suggestion',
        docs: { description: 'Call `createEffect` only in `*.effects.ts` files.' },
        schema: [],
        messages: { placement: 'Define effects in a `*.effects.ts` file.' },
    },
    create(context) {
        const filename = context.filename ?? context.getFilename?.() ?? '';
        if (EFFECTS_FILE.test(filename)) return {};
        return {
            CallExpression(node) {
                if (node.callee.type === 'Identifier' && node.callee.name === 'createEffect') {
                    context.report({ node, messageId: 'placement' });
                }
            },
        };
    },
};
