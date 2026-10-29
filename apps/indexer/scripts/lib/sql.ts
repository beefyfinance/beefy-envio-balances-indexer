/**
 * The query parameters of the ClickHouse statements the scripts send over HTTP. Statements are built with the `sql` tag
 * of `@beefy/clickhouse` (Postgres ones with `pgSql`, scripts/lib/pgSql.ts): a value is a `{p_<n>:Type}` placeholder in
 * the text, sent apart as `param_p_<n>` and parsed by ClickHouse as that type. This is the encoding of those values.
 */
import type { ParamScalar, ParamValue, QueryParams } from '@beefy/clickhouse';
import * as R from 'remeda';

const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ESCAPES: Record<string, string> = {
    '\\': '\\\\',
    '\t': '\\t',
    '\n': '\\n',
    '\r': '\\r',
    '\0': '\\0',
    '\b': '\\b',
    '\f': '\\f',
};

/** A string in ClickHouse's escaped text format: what a `String` parameter is parsed with. */
const escaped = (value: string): string => value.replace(/[\\\t\n\r\0\b\f]/g, (char) => ESCAPES[char] ?? char);

const scalar = (value: number | bigint): string => {
    if (typeof value === 'number' && !Number.isFinite(value))
        throw new Error(`query parameter is not finite: ${value}`);
    return String(value);
};

/** An array or map element: strings quoted (backslash escapes), numbers as they are. */
const element = (value: ParamScalar): string =>
    typeof value === 'string' ? `'${escaped(value).replace(/'/g, "\\'")}'` : scalar(value);

/** A parameter value as ClickHouse parses it for its declared type (it rejects anything that does not parse whole). */
export const encodeParam = (value: ParamValue): string => {
    if (typeof value === 'string') return escaped(value);
    if (typeof value === 'number' || typeof value === 'bigint') return scalar(value);
    if (value instanceof Map) {
        return `{${R.map([...value], ([key, item]) => `${element(key)}:${element(item)}`).join(',')}}`;
    }
    return `[${R.map(value as readonly ParamScalar[], element).join(',')}]`;
};

/** `param_<name>` search parameters of a ClickHouse HTTP request; a malformed name throws. */
export const paramEntries = (params: QueryParams): [string, string][] =>
    R.map(R.entries(params), ([name, value]): [string, string] => {
        if (!PARAM_NAME.test(name)) throw new Error(`invalid query parameter name: ${JSON.stringify(name)}`);
        return [`param_${name}`, encodeParam(value)];
    });
