/**
 * Postgres SQL for psql, built only with the {@link pgSql} tag (the Postgres twin of `sql` from `@beefy/clickhouse`).
 * Its interpolations are typed fragments, never strings or numbers:
 *
 * - a **value** ({@link pgValue}, {@link pgBigint}): a psql variable `:'v_<n>'` in the text (a literal quoted by psql
 *   itself), the value passed apart as `-v v_<n>=<value>`;
 * - a **name** ({@link pgIdent}, {@link pgQualified}): a strict pattern, double quoted, anything else throws;
 * - a **keyword or fragment of our own code** ({@link pgRaw}): only a string literal type is accepted;
 * - another {@link PgSql}: its text and its variables, renumbered so names never collide.
 */

const KIND: unique symbol = Symbol('pg sql kind');
const PARTS: unique symbol = Symbol('pg sql parts');

type Variable = { readonly value: string; readonly cast: '' | '::bigint' };
type Part = string | Variable;
type Fragment<Kind extends string> = { readonly [KIND]: Kind; readonly [PARTS]: readonly Part[] };

/** psql variables (`-v name=value`), read in the SQL as `:'name'`. */
export type PgVars = Readonly<Record<string, string>>;
/** SQL text and the psql variables it reads, built by {@link pgSql} only. Immutable. */
export type PgSql = Fragment<'sql'> & { readonly text: string; readonly vars: PgVars };
/** A value sent as a psql variable ({@link pgValue}, {@link pgBigint}). */
export type PgParam = Fragment<'param'>;
/** A checked, double quoted name ({@link pgIdent}, {@link pgQualified}). */
export type PgIdentifier = Fragment<'identifier'>;
/** A keyword or fragment written in our own code ({@link pgRaw}). */
export type PgRaw = Fragment<'raw'>;
/** What {@link pgSql} accepts between its strings. */
export type PgPart = PgSql | PgParam | PgIdentifier | PgRaw;

function fragment<Kind extends 'param' | 'identifier' | 'raw'>(kind: Kind, parts: readonly Part[]): Fragment<Kind> {
    return Object.freeze({ [KIND]: kind, [PARTS]: Object.freeze(parts) });
}

function partsOf(value: PgPart): readonly Part[] {
    // TypeScript refuses anything else; this refuses what a cast lets through
    if (typeof value !== 'object' || value === null || !(KIND in value) || !Array.isArray(value[PARTS])) {
        throw new Error(`not a SQL fragment: ${typeof value}`);
    }
    return value[PARTS];
}

/** Variables numbered in order of appearance: a nested fragment's are renumbered with the rest. */
function build(parts: readonly Part[]): PgSql {
    const vars: Record<string, string> = {};
    let count = 0;
    const text = parts
        .map((part) => {
            if (typeof part === 'string') return part;
            const name = `v_${count}`;
            count += 1;
            vars[name] = part.value;
            return `:'${name}'${part.cast}`;
        })
        .join('');
    return Object.freeze({ [KIND]: 'sql' as const, [PARTS]: Object.freeze(parts), text, vars: Object.freeze(vars) });
}

/** The tag: SQL text from our own strings and typed fragments ({@link PgPart}); a plain string or number is refused. */
export function pgSql(strings: TemplateStringsArray, ...values: readonly PgPart[]): PgSql {
    return build(
        strings.flatMap((text, index) => {
            // undefined for an invalid escape sequence, which a tagged template allows
            if (typeof text !== 'string') throw new Error('invalid escape sequence in SQL template');
            if (index >= values.length) return [text];
            const value = values[index];
            if (value === undefined) throw new Error('not a SQL fragment: undefined');
            return [text, ...partsOf(value)];
        })
    );
}

/** Whether `value` is a {@link PgSql} built by {@link pgSql}. */
export function isPgSql(value: unknown): value is PgSql {
    return typeof value === 'object' && value !== null && KIND in value && value[KIND] === 'sql';
}

/** Fragments one after the other, `separator` (a comma by default) between them. */
export function pgJoin(fragments: readonly PgPart[], separator: PgSql = pgSql`, `): PgSql {
    return build(fragments.flatMap((item, index) => [...(index === 0 ? [] : partsOf(separator)), ...partsOf(item)]));
}

function variable(value: string | number | bigint, cast: Variable['cast']): PgParam {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`psql variable is not finite: ${value}`);
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
        throw new Error(`invalid psql variable value: ${typeof value}`);
    }
    const text = String(value);
    // psql variables are single-line; a newline or NUL in a value is never legitimate here
    if (/[\n\r\0]/.test(text)) throw new Error('invalid value for a psql variable');
    return fragment('param', [{ value: text, cast }]);
}

/** A value as an untyped literal (`:'v_<n>'`): Postgres types it from where it is used, as any quoted literal. */
export function pgValue(value: string | number | bigint): PgParam {
    return variable(value, '');
}

/** An integer as `bigint` (`:'v_<n>'::bigint`), where the context does not type it (`LIMIT`). */
export function pgBigint(value: number | bigint): PgParam {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`invalid bigint: ${value}`);
    return variable(value, '::bigint');
}

/** A keyword or fragment written in our own code: a string literal type only. */
export function pgRaw<T extends string>(text: string extends T ? never : T): PgRaw {
    return fragment('raw', [text]);
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function quoted(name: string): string {
    if (!IDENTIFIER.test(name)) throw new Error(`invalid Postgres identifier: ${JSON.stringify(name)}`);
    return `"${name}"`;
}

/** The only way a name reaches SQL text: a plain identifier (at most 63 characters), double quoted; else it throws. */
export function pgIdent(name: string): PgIdentifier {
    return fragment('identifier', [quoted(name)]);
}

/** `"schema"."table"`, both through {@link pgIdent}. */
export function pgQualified(schema: string, table: string): PgIdentifier {
    return fragment('identifier', [`${quoted(schema)}.${quoted(table)}`]);
}
