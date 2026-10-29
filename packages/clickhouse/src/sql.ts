import type { ClickhouseConfig } from '@beefy/config';

/**
 * How SQL text is built: only with the {@link sql} tag, whose interpolations are typed fragments, never strings or
 * numbers. What each kind of fragment puts in the text:
 *
 * - a **value** ({@link param}): a `{p_<n>:<Type>}` placeholder, the value sent apart (`query_params`) and parsed by
 *   ClickHouse as that type. The type is spelled out by the caller, never inferred from the JS value;
 * - a **name** ({@link ident}, {@link qualified}): a strict pattern, backtick quoted, anything else throws. Names are
 *   inlined because ClickHouse takes no parameter where some of them go (inside a view's definition, `{x:Identifier}`
 *   is a view parameter);
 * - an **integer** ({@link int}): checked, inlined, for the places that take no parameter (a view's definition, a
 *   settings profile's values);
 * - a **keyword or constant of our own code** ({@link raw}, {@link literal} for a quoted string): only a string literal
 *   type is accepted;
 * - another **{@link Sql}** fragment: its text and its parameters, renumbered so placeholders never collide.
 *
 * A version number in a table name is checked as an integer first ({@link versionNumber}).
 */

// nothing outside this module can name these symbols, so nothing outside it can build a fragment
const KIND: unique symbol = Symbol('sql kind');
const PARTS: unique symbol = Symbol('sql parts');

/** A value as the client sends it in `query_params`; arrays and maps follow ClickHouse's text format for those types. */
export type ParamScalar = string | number | bigint;
export type ParamValue = ParamScalar | readonly ParamScalar[] | ReadonlyMap<ParamScalar, ParamScalar>;
export type QueryParams = Readonly<Record<string, ParamValue>>;

type Placeholder = { readonly type: ParamType; readonly value: ParamValue };
type Part = string | Placeholder;
type Fragment<Kind extends string> = { readonly [KIND]: Kind; readonly [PARTS]: readonly Part[] };

/** SQL text and the values of its `{p_<n>:Type}` placeholders, built by {@link sql} only. Immutable. */
export type Sql = Fragment<'sql'> & { readonly text: string; readonly params: QueryParams };
/** A typed query parameter ({@link param}). */
export type Param = Fragment<'param'>;
/** A checked, quoted name ({@link ident}, {@link qualified}); `text` is the quoted name. */
export type Identifier = Fragment<'identifier'> & { readonly text: string };
/** A checked integer, inlined ({@link int}). */
export type SqlInt = Fragment<'int'>;
/** A keyword or literal written in our own code ({@link raw}). */
export type Raw = Fragment<'raw'>;
/** What {@link sql} accepts between its strings. */
export type SqlPart = Sql | Param | Identifier | SqlInt | Raw;

type Int = number | bigint;

/** The ClickHouse type of each {@link param}, and the JS value it takes. */
export type ParamTypes = {
    String: string;
    UInt8: number;
    UInt32: number;
    UInt64: Int;
    Int32: number;
    Int64: Int;
    Float64: number;
    "DateTime('UTC')": string;
    "DateTime64(3, 'UTC')": string;
    "DateTime64(6, 'UTC')": string;
    'Array(String)': readonly string[];
    'Array(Int64)': readonly Int[];
    'Map(Int32, UInt64)': ReadonlyMap<number, Int>;
    'Map(String, String)': ReadonlyMap<string, string>;
};
export type ParamType = keyof ParamTypes;

const INT_RANGES: Record<'UInt8' | 'UInt32' | 'UInt64' | 'Int32' | 'Int64', readonly [bigint, bigint]> = {
    UInt8: [0n, 255n],
    UInt32: [0n, 4_294_967_295n],
    UInt64: [0n, 18_446_744_073_709_551_615n],
    Int32: [-2_147_483_648n, 2_147_483_647n],
    Int64: [-9_223_372_036_854_775_808n, 9_223_372_036_854_775_807n],
};

const DATE_TIME_6 = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

function checkInt(type: keyof typeof INT_RANGES, value: unknown): Int {
    const [min, max] = INT_RANGES[type];
    const big = typeof value === 'bigint' ? value : Number.isSafeInteger(value) ? BigInt(value as number) : undefined;
    if (big === undefined || big < min || big > max) throw new Error(`invalid ${type} parameter: ${String(value)}`);
    return value as Int;
}

function checkString(value: unknown): string {
    if (typeof value !== 'string') throw new Error(`invalid String parameter: ${String(value)}`);
    return value;
}

/** A value checked against its declared type (TypeScript checks it too; this holds for callers that cast). */
function checkValue(type: ParamType, value: unknown): ParamValue {
    switch (type) {
        case 'String':
            return checkString(value);
        case 'UInt8':
        case 'UInt32':
        case 'UInt64':
        case 'Int32':
        case 'Int64':
            return checkInt(type, value);
        case 'Float64':
            if (typeof value !== 'number' || !Number.isFinite(value))
                throw new Error(`invalid Float64 parameter: ${String(value)}`);
            return value;
        case "DateTime('UTC')":
            // whole seconds: what a DateTime parses
            return utcTime(checkString(value)).slice(0, 19);
        case "DateTime64(3, 'UTC')":
            return utcTime(checkString(value));
        case "DateTime64(6, 'UTC')": {
            const time = checkString(value);
            // checked as a real calendar time; the microseconds are kept as they are
            if (!DATE_TIME_6.test(time)) throw new Error(`invalid DateTime64(6) parameter: ${JSON.stringify(time)}`);
            utcTime(time);
            return time;
        }
        case 'Array(String)':
        case 'Array(Int64)':
            if (!Array.isArray(value)) throw new Error(`invalid ${type} parameter`);
            return value.map((item: unknown) =>
                type === 'Array(String)' ? checkString(item) : checkInt('Int64', item)
            );
        case 'Map(Int32, UInt64)':
        case 'Map(String, String)': {
            if (!(value instanceof Map)) throw new Error(`invalid ${type} parameter`);
            const entries = [...(value as Map<unknown, unknown>)];
            return new Map<ParamScalar, ParamScalar>(
                entries.map(([key, item]): [ParamScalar, ParamScalar] =>
                    type === 'Map(String, String)'
                        ? [checkString(key), checkString(item)]
                        : [checkInt('Int32', key), checkInt('UInt64', item)]
                )
            );
        }
        default:
            throw new Error(`unsupported parameter type: ${JSON.stringify(type)}`);
    }
}

function fragment<Kind extends 'param' | 'int' | 'raw'>(kind: Kind, parts: readonly Part[]): Fragment<Kind> {
    return Object.freeze({ [KIND]: kind, [PARTS]: Object.freeze(parts) });
}

function partsOf(value: SqlPart): readonly Part[] {
    // TypeScript refuses anything else; this refuses what a cast lets through
    if (typeof value !== 'object' || value === null || !(KIND in value) || !Array.isArray(value[PARTS])) {
        throw new Error(`not a SQL fragment: ${typeof value}`);
    }
    return value[PARTS];
}

/** Placeholders numbered in order of appearance: a nested fragment's parameters are renumbered with the rest. */
function build(parts: readonly Part[]): Sql {
    const params: Record<string, ParamValue> = {};
    let count = 0;
    const text = parts
        .map((part) => {
            if (typeof part === 'string') return part;
            const name = `p_${count}`;
            count += 1;
            params[name] = part.value;
            return `{${name}:${part.type}}`;
        })
        .join('');
    return Object.freeze({
        [KIND]: 'sql' as const,
        [PARTS]: Object.freeze(parts),
        text,
        params: Object.freeze(params),
    });
}

/** The tag: SQL text from our own strings and typed fragments ({@link SqlPart}); a plain string or number is refused. */
export function sql(strings: TemplateStringsArray, ...values: readonly SqlPart[]): Sql {
    return build(
        strings.flatMap((text, index) => {
            // undefined for an invalid escape sequence, which a tagged template allows
            if (typeof text !== 'string') throw new Error('invalid escape sequence in SQL template');
            const value = values[index];
            if (index < values.length && value === undefined) throw new Error('not a SQL fragment: undefined');
            return value === undefined ? [text] : [text, ...partsOf(value)];
        })
    );
}

/** Whether `value` is a {@link Sql} built by {@link sql} (for callers that must not trust a cast). */
export function isSql(value: unknown): value is Sql {
    return typeof value === 'object' && value !== null && KIND in value && value[KIND] === 'sql';
}

/** Whether `value` is an {@link Identifier} built by {@link ident} or {@link qualified}. */
export function isIdentifier(value: unknown): value is Identifier {
    return typeof value === 'object' && value !== null && KIND in value && value[KIND] === 'identifier';
}

/** Fragments one after the other, `separator` (a comma by default) between them. */
export function join(fragments: readonly SqlPart[], separator: Sql = sql`, `): Sql {
    return build(fragments.flatMap((item, index) => [...(index === 0 ? [] : partsOf(separator)), ...partsOf(item)]));
}

/** A query parameter of ClickHouse type `type` (spelled out, never inferred), checked against it. */
export function param<T extends ParamType>(type: T, value: ParamTypes[T]): Param {
    return fragment('param', [{ type, value: checkValue(type, value) }]);
}

/** An integer inlined in the text, where ClickHouse takes no parameter: checked as a safe integer. */
export function int(value: number | bigint): SqlInt {
    if (typeof value !== 'bigint' && !Number.isSafeInteger(value))
        throw new Error(`invalid integer: ${JSON.stringify(value)}`);
    return fragment('int', [String(value)]);
}

/**
 * A keyword, operator or literal written in our own code (`'PENDING'`, `ASC`): a string literal type only, so no value
 * computed at run time can get there.
 */
export function raw<T extends string>(text: string extends T ? never : T): Raw {
    return fragment('raw', [text]);
}

/**
 * A string constant of our own code as a quoted, escaped ClickHouse literal, where ClickHouse takes no parameter (a
 * view's definition): a string literal type only, like {@link raw}.
 */
export function literal<T extends string>(value: string extends T ? never : T): Raw {
    const text: string = value;
    return fragment('raw', [`'${text.replace(/[\\']/g, (char) => `\\${char}`)}'`]);
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,190}$/;

function checkedName(name: string): string {
    if (!IDENTIFIER.test(name)) throw new Error(`invalid ClickHouse identifier: ${JSON.stringify(name)}`);
    return `\`${name}\``;
}

function identifierOf(text: string): Identifier {
    return Object.freeze({ [KIND]: 'identifier' as const, [PARTS]: Object.freeze([text]), text });
}

/** The only way a name reaches SQL text: a plain identifier, quoted; anything else throws. */
export function ident(name: string): Identifier {
    return identifierOf(checkedName(name));
}

/** `database.table`, both through {@link ident}. */
export function qualified(database: string, table: string): Identifier {
    return identifierOf(`${checkedName(database)}.${checkedName(table)}`);
}

/** A configured `database.table` name, split then quoted by {@link qualified}. */
export function qualifiedName(name: string): Identifier {
    const [database, table, ...rest] = name.split('.');
    if (database === undefined || table === undefined || rest.length > 0) {
        throw new Error(`expected database.table, got ${JSON.stringify(name)}`);
    }
    return qualified(database, table);
}

/** The database part of a configured `database.table` name. */
export function databaseOf(name: string): string {
    return name.split('.')[0] ?? '';
}

/** A deployment version number: it ends up in table names (`event_price_<N>`). */
export function versionNumber(value: number | string): number {
    const version = typeof value === 'number' ? value : /^\d{1,7}$/.test(value) ? Number(value) : Number.NaN;
    if (!Number.isInteger(version) || version < 1 || version > 1_000_000) {
        throw new Error(`version must be an integer between 1 and 1000000, got ${JSON.stringify(value)}`);
    }
    return version;
}

const UTC_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?)?Z?$/;

/**
 * A UTC time given by an operator or read back from ClickHouse, checked (a real calendar time) and normalised to
 * `YYYY-MM-DD HH:MM:SS.fff`, what a `DateTime64(3, 'UTC')` parameter takes. Throws on anything else.
 */
export function utcTime(value: string): string {
    const match = UTC_TIME.exec(value);
    const ms =
        match === null
            ? Number.NaN
            : Date.parse(
                  `${match[1]}-${match[2]}-${match[3]}T${match[4] ?? '00'}:${match[5] ?? '00'}:${match[6] ?? '00'}.${(match[7] ?? '0').slice(0, 3).padEnd(3, '0')}Z`
              );
    const normalised = Number.isNaN(ms) ? undefined : timeOf(ms);
    // Date.parse rolls 2024-02-30 over to March: compare the date back
    if (normalised === undefined || match === null || !normalised.startsWith(`${match[1]}-${match[2]}-${match[3]}`)) {
        throw new Error(`time must be 'YYYY-MM-DD[ HH:MM:SS[.fff]]' UTC, got ${JSON.stringify(value)}`);
    }
    return normalised;
}

/** Milliseconds since the epoch, as {@link utcTime} writes them. */
export function timeOf(ms: number): string {
    return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

/** {@link utcTime}'s string back to milliseconds since the epoch. */
export function msOf(time: string): number {
    return Date.parse(`${utcTime(time).replace(' ', 'T')}Z`);
}

/** The databarn tables prices are read from, as `database.table` names. Read only. */
export type PriceTables = {
    /** 5 minute prices: asset_id, date_time, price, price_source. */
    price5m: string;
    /** (chain_id, representation_address) to price `asset_id`; a vault's or CLM's share token is its own asset. */
    token: string;
};

/**
 * Everything the statements need to know about where things live. Built once from the configuration
 * ({@link schemaFromConfig}); the Envio database is per version and comes from `deployments`, not from here.
 */
export type Schema = {
    /** Ours, stable (`beefy_indexer_<env>`): `deployments`, the API views and every version's `_<N>` tables. */
    database: string;
    prices: PriceTables;
    /** `price_source` values of the 5 minute table the watermark waits for. */
    watermarkPriceSources: readonly string[];
    /**
     * The ClickHouse user the API views run as (`SQL SECURITY DEFINER`). Set in production: the API user then needs no
     * grant on Envio's databases, the version tables or the price tables. Unset in tests, where the connecting user is
     * enough.
     */
    definer?: string;
    /**
     * The common prefix of Envio's version databases (`envio_dev_mrt_`): version N's Envio database must be
     * `<prefix><N>` ({@link envioDatabaseOf}), which is what deploy accepts and the only kind of database cleanup drops.
     */
    envioDatabasePrefix: string;
};

export function schemaFromConfig(config: ClickhouseConfig): Schema {
    return {
        database: config.analyticsDatabase,
        prices: { price5m: config.price5mTable, token: config.tokenTable },
        watermarkPriceSources: config.watermarkPriceSources,
        ...(config.definer === undefined ? {} : { definer: config.definer }),
        envioDatabasePrefix: config.envioDatabasePrefix,
    };
}

const PREFIX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The only Envio database version N may use: `<prefix><N>`. Deploy refuses any other name and cleanup checks it again
 * right before a `DROP DATABASE`, so a row of `deployments` written by mistake (or by hand) cannot get a database
 * outside Envio's versions dropped.
 */
export function envioDatabaseOf(schema: Pick<Schema, 'envioDatabasePrefix'>, version: number): string {
    if (!PREFIX.test(schema.envioDatabasePrefix)) {
        throw new Error(`invalid Envio database prefix: ${JSON.stringify(schema.envioDatabasePrefix)}`);
    }
    return `${schema.envioDatabasePrefix}${versionNumber(version)}`;
}

/** Whether `name` is an Envio version database (`<prefix><N>`), and then its N. */
export function envioDatabaseVersion(schema: Pick<Schema, 'envioDatabasePrefix'>, name: string): number | undefined {
    if (!PREFIX.test(schema.envioDatabasePrefix) || !name.startsWith(schema.envioDatabasePrefix)) return undefined;
    const rest = name.slice(schema.envioDatabasePrefix.length);
    // canonical numbers only: `<prefix>04` is not version 4's
    return /^[1-9]\d*$/.test(rest) && Number(rest) <= 1_000_000 ? Number(rest) : undefined;
}

export function definerClause({ definer }: Pick<Schema, 'definer'>): Sql {
    return definer === undefined ? sql`` : sql`\nDEFINER = ${ident(definer)} SQL SECURITY DEFINER`;
}
