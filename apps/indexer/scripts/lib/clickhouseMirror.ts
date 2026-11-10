/**
 * Copies, for one chain, the entity tables a Postgres schema does not hold from Envio's ClickHouse sink into a scratch
 * Postgres schema, so that checks written in Postgres SQL (scripts/correctness.ts) read them as if Envio had stored
 * them there.
 *
 * Since the storage split (`@storage` in schema.graphql), TimelineEvent, ContractLink and the event tables live in
 * ClickHouse only. Envio keeps every version of a row in `envio_history_<Entity>`; the copy takes the latest version of
 * each id up to the chain's committed checkpoint (`envio_chains`), as Envio's own `<Entity>` views do, but filtered on
 * the chain before the deduplication. Column names are ClickHouse's (Envio's snake_case, the same in Postgres); column
 * types come from schema.graphql, as Envio creates them in Postgres: a BigInt is `numeric`, though ClickHouse stores it
 * as a String unless it has a precision.
 */
import { type Sql, ident, join, param, sql } from '@beefy/clickhouse';
import * as R from 'remeda';

import { type PgRaw, type PgSql, pgIdent, pgJoin, pgQualified, pgRaw, pgSql } from './pgSql.ts';

/** The Postgres column types of a copy. */
export type PgType = 'numeric' | 'integer' | 'bigint' | 'double precision' | 'boolean' | 'timestamptz' | 'text';

const PG_TYPE_SQL: Record<PgType, PgRaw> = {
    numeric: pgRaw('numeric'),
    integer: pgRaw('integer'),
    bigint: pgRaw('bigint'),
    'double precision': pgRaw('double precision'),
    boolean: pgRaw('boolean'),
    timestamptz: pgRaw('timestamptz'),
    text: pgRaw('text'),
};

const GRAPHQL_PG_TYPES: Readonly<Record<string, PgType>> = {
    BigInt: 'numeric',
    BigDecimal: 'numeric',
    Int: 'integer',
    Float: 'double precision',
    Boolean: 'boolean',
    Timestamp: 'timestamptz',
    String: 'text',
    Bytes: 'text',
    ID: 'text',
};

/** Envio's column name of a GraphQL field: `sharesAfter` → `shares_after`. */
export const snakeCase = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** Per entity, the GraphQL type of each column (snake_case name), from schema.graphql: `{ TimelineEvent: { delta: 'BigInt' } }`. */
export const graphqlColumnTypes = (schemaGraphql: string): ReadonlyMap<string, ReadonlyMap<string, string>> => {
    const entities = new Map<string, Map<string, string>>();
    let current: Map<string, string> | undefined;
    let pending: string | undefined;
    for (const line of schemaGraphql.split('\n')) {
        const opening = /^type\s+(\w+)/.exec(line);
        if (opening?.[1] !== undefined) pending = opening[1];
        if (pending !== undefined && line.includes('{')) {
            current = new Map();
            entities.set(pending, current);
            pending = undefined;
            continue;
        }
        if (/^\}/.test(line)) current = undefined;
        const field = current === undefined ? null : /^\s+(\w+)\s*:\s*\[?\s*(\w+)/.exec(line);
        if (current !== undefined && field?.[1] !== undefined && field[2] !== undefined) {
            current.set(snakeCase(field[1]), field[2]);
        }
    }
    return entities;
};

const WRAPPER = /^(?:Nullable|LowCardinality)\((.*)\)$/;

/** A column's Postgres type: its GraphQL type's (enums are text), else, for Envio's own columns (`chain_id`), ClickHouse's. */
export const pgTypeOf = (graphqlType: string | undefined, clickhouseType: string): PgType => {
    if (graphqlType !== undefined) return GRAPHQL_PG_TYPES[graphqlType] ?? 'text';
    let base = clickhouseType;
    for (let wrapped = WRAPPER.exec(base); wrapped?.[1] !== undefined; wrapped = WRAPPER.exec(base)) base = wrapped[1];
    if (/^(Int(8|16|32)|UInt(8|16))$/.test(base)) return 'integer';
    if (/^(UInt32|Int64)$/.test(base)) return 'bigint';
    if (/^(UInt64|U?Int(128|256)|Decimal)/.test(base)) return 'numeric';
    if (/^Float(32|64)$/.test(base)) return 'double precision';
    if (base === 'Bool') return 'boolean';
    if (/^DateTime/.test(base)) return 'timestamptz';
    return 'text';
};

/** The scratch schema of a copy: `<schema>__ch_<chain id>`, a plain identifier of at most 63 characters. */
export const mirrorSchemaName = (schema: string, chainId: number): string => {
    const name = `${schema}__ch_${chainId}`;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) throw new Error(`mirror schema name too long or invalid: ${name}`);
    return name;
};

export type MirrorColumn = { name: string; pgType: PgType };

/** The latest version of each row of `table` on the chain, up to its committed checkpoint, DELETE rows dropped. */
export const latestRowsStatement = (table: string, columns: readonly string[], chainId: number): Sql => {
    const names = join(R.map(columns, (name) => ident(name)));
    return sql`
WITH
(SELECT max(checkpoint_id) FROM ${ident('envio_chains')} FINAL WHERE chain_id = ${param('Int32', chainId)}) AS frontier,
latest AS
(
    SELECT ${names}, envio_change
    FROM ${ident(`envio_history_${table}`)}
    WHERE chain_id = ${param('Int32', chainId)} AND envio_checkpoint_id <= frontier
    ORDER BY id, envio_checkpoint_id DESC
    LIMIT 1 BY id
)
SELECT ${names}
FROM latest
WHERE envio_change = 'SET'`;
};

/** `create table "<schema>"."<table>" (...)` with the copy's columns. */
export const createTableStatement = (schema: string, table: string, columns: readonly MirrorColumn[]): PgSql =>
    pgSql`create table ${pgQualified(schema, table)} (${pgJoin(
        R.map(columns, ({ name, pgType }) => pgSql`${pgIdent(name)} ${PG_TYPE_SQL[pgType]}`)
    )})`;

/**
 * The psql meta-command loading ClickHouse's CSVWithNames answer from stdin: the header row is skipped, an unquoted
 * `\N` is NULL (ClickHouse's NULL in CSV), and a quoted empty field stays an empty string.
 */
export const copyCommand = (schema: string, table: string, columns: readonly MirrorColumn[]): PgSql =>
    pgSql`\\copy ${pgQualified(schema, table)} (${pgJoin(R.map(columns, ({ name }) => pgIdent(name)))}) from stdin with (format csv, header true, null '\\N')`;

/** Drops a copy's scratch schema and everything in it; refuses any schema not named as a copy (`<schema>__ch_<chain>`). */
export const dropMirrorStatement = (mirror: string): PgSql => {
    if (!/__ch_\d+$/.test(mirror)) throw new Error(`not a mirror schema: ${mirror}`);
    return pgSql`drop schema if exists ${pgIdent(mirror)} cascade`;
};

/** What a copy needs from ClickHouse and Postgres. */
export type MirrorIo = {
    /** The columns (name, ClickHouse type) of Envio's view of `table` in the ClickHouse database; none if it has none. */
    clickhouseColumns: (table: string) => Promise<{ name: string; type: string }[]>;
    /** The answer of a ClickHouse statement in CSVWithNames. */
    clickhouseCsv: (statement: Sql) => Promise<ReadableStream<Uint8Array>>;
    /** Runs a Postgres statement. */
    pg: (statement: PgSql) => Promise<unknown>;
    /** Runs a psql `\copy ... from stdin` with `data` as stdin; the number of rows copied. */
    pgCopy: (command: PgSql, data: ReadableStream<Uint8Array>) => Promise<number>;
};

export type Mirror = {
    /** The scratch schema holding the copies. */
    schema: string;
    /** Rows copied per table. */
    rows: ReadonlyMap<string, number>;
};

/**
 * Copies `tables` (entity names) of the chain from ClickHouse into a fresh `<schema>__ch_<chain>` (an older one of the
 * same name, left by an interrupted run, is replaced). A table ClickHouse does not have either is skipped: the check
 * reading it fails with Postgres' own error. Drop the schema with {@link dropMirrorStatement} once done.
 */
export const mirrorTables = async (
    io: MirrorIo,
    {
        schema,
        chainId,
        tables,
        schemaGraphql,
    }: { schema: string; chainId: number; tables: readonly string[]; schemaGraphql: string }
): Promise<Mirror> => {
    const mirror = mirrorSchemaName(schema, chainId);
    const graphql = graphqlColumnTypes(schemaGraphql);
    await io.pg(dropMirrorStatement(mirror));
    await io.pg(pgSql`create schema ${pgIdent(mirror)}`);
    const rows = new Map<string, number>();
    for (const table of tables) {
        const chColumns = await io.clickhouseColumns(table);
        if (chColumns.length === 0) continue;
        const columns = R.map(chColumns, ({ name, type }) => ({
            name,
            pgType: pgTypeOf(graphql.get(table)?.get(name), type),
        }));
        await io.pg(createTableStatement(mirror, table, columns));
        const data = await io.clickhouseCsv(
            latestRowsStatement(
                table,
                R.map(columns, ({ name }) => name),
                chainId
            )
        );
        rows.set(table, await io.pgCopy(copyCommand(mirror, table, columns), data));
    }
    return { schema: mirror, rows };
};
