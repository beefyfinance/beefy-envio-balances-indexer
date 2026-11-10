import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Sql } from '@beefy/clickhouse';
import { describe, expect, it } from 'vitest';

import {
    copyCommand,
    createTableStatement,
    dropMirrorStatement,
    graphqlColumnTypes,
    latestRowsStatement,
    type MirrorIo,
    mirrorSchemaName,
    mirrorTables,
    pgTypeOf,
    snakeCase,
} from './clickhouseMirror.ts';
import { type PgSql, pgIdent, pgSql } from './pgSql.ts';

const schemaGraphql = readFileSync(join(import.meta.dirname, '..', '..', 'schema.graphql'), 'utf8');

describe('column types', () => {
    it("reads Envio's column names and GraphQL types from schema.graphql", () => {
        expect(snakeCase('sharesAfter')).toBe('shares_after');
        expect(snakeCase('amount0')).toBe('amount0');
        const timeline = graphqlColumnTypes(schemaGraphql).get('TimelineEvent');
        expect(timeline?.get('delta')).toBe('BigInt');
        expect(timeline?.get('shares_after')).toBe('BigInt');
        expect(timeline?.get('block_timestamp')).toBe('Timestamp');
        expect(timeline?.get('kind')).toBe('TimelineKind');
        expect(graphqlColumnTypes(schemaGraphql).get('ContractLink')?.get('from_address')).toBeDefined();
    });

    it('types a column as Envio does in Postgres: from GraphQL, else from ClickHouse', () => {
        // a BigInt without precision is a String in ClickHouse, numeric in Postgres (the checks add and compare them)
        expect(pgTypeOf('BigInt', 'String')).toBe('numeric');
        expect(pgTypeOf('TimelineKind', "Enum8('BALANCE' = 1)")).toBe('text');
        expect(pgTypeOf('Timestamp', "DateTime64(3, 'UTC')")).toBe('timestamptz');
        expect(pgTypeOf('Int', 'Int32')).toBe('integer');
        expect(pgTypeOf(undefined, 'Int32')).toBe('integer');
        expect(pgTypeOf(undefined, 'UInt64')).toBe('numeric');
        expect(pgTypeOf(undefined, 'Nullable(Int64)')).toBe('bigint');
        expect(pgTypeOf(undefined, 'LowCardinality(Nullable(String))')).toBe('text');
        expect(pgTypeOf(undefined, 'Decimal(20, 0)')).toBe('numeric');
        expect(pgTypeOf(undefined, 'Nullable(Float64)')).toBe('double precision');
    });
});

describe('statements', () => {
    it('reads the latest version of each row of the chain up to its committed checkpoint, deletions dropped', () => {
        const { text, params } = latestRowsStatement('TimelineEvent', ['id', 'delta', 'user'], 4326);
        expect(text).toContain('FROM `envio_history_TimelineEvent`');
        expect(text).toContain('`envio_chains` FINAL WHERE chain_id = {p_0:Int32}');
        expect(text).toContain('chain_id = {p_1:Int32} AND envio_checkpoint_id <= frontier');
        expect(text.indexOf('WHERE chain_id = {p_1')).toBeLessThan(text.indexOf('LIMIT 1 BY id'));
        expect(text).toMatch(/WHERE envio_change = 'SET'$/);
        expect(text).toContain('`id`, `delta`, `user`');
        expect(text).not.toMatch(/FROM\s*\(\s*SELECT/);
        expect(params).toEqual({ p_0: 4326, p_1: 4326 });
    });

    it('creates and loads the copy with quoted names and the CSV NULL of ClickHouse', () => {
        const columns = [
            { name: 'id', pgType: 'text' as const },
            { name: 'delta', pgType: 'numeric' as const },
        ];
        expect(createTableStatement('beefy_v13__ch_10', 'TimelineEvent', columns).text).toBe(
            'create table "beefy_v13__ch_10"."TimelineEvent" ("id" text, "delta" numeric)'
        );
        const copy = copyCommand('beefy_v13__ch_10', 'TimelineEvent', columns);
        expect(copy.text).toBe(
            `\\copy "beefy_v13__ch_10"."TimelineEvent" ("id", "delta") from stdin with (format csv, header true, null '\\N')`
        );
        expect(copy.vars).toEqual({});
    });

    it('names and drops only scratch schemas', () => {
        expect(mirrorSchemaName('beefy_v13', 10)).toBe('beefy_v13__ch_10');
        expect(() => mirrorSchemaName('x'.repeat(60), 10)).toThrow('too long or invalid');
        expect(dropMirrorStatement('beefy_v13__ch_10').text).toBe('drop schema if exists "beefy_v13__ch_10" cascade');
        expect(() => dropMirrorStatement('beefy_v13')).toThrow('not a mirror schema');
    });
});

describe('mirrorTables', () => {
    it('replaces the scratch schema, copies each table ClickHouse has and skips the others', async () => {
        const pg: string[] = [];
        const copies: string[] = [];
        const selects: Sql[] = [];
        const io: MirrorIo = {
            clickhouseColumns: async (table) =>
                table === 'TimelineEvent'
                    ? [
                          { name: 'id', type: 'String' },
                          { name: 'delta', type: 'String' },
                          { name: 'chain_id', type: 'Int32' },
                      ]
                    : [],
            clickhouseCsv: async (statement) => {
                selects.push(statement);
                return new ReadableStream();
            },
            pg: async (statement: PgSql) => {
                pg.push(statement.text);
            },
            pgCopy: async (command) => {
                copies.push(command.text);
                return 42;
            },
        };
        const mirror = await mirrorTables(io, {
            schema: 'beefy_v13',
            chainId: 10,
            tables: ['TimelineEvent', 'Missing'],
            schemaGraphql,
        });
        expect(mirror).toEqual({ schema: 'beefy_v13__ch_10', rows: new Map([['TimelineEvent', 42]]) });
        // delta typed from schema.graphql (BigInt), chain_id from ClickHouse (Int32, not in the GraphQL schema)
        const columns = [
            { name: 'id', pgType: 'text' as const },
            { name: 'delta', pgType: 'numeric' as const },
            { name: 'chain_id', pgType: 'integer' as const },
        ];
        expect(pg).toEqual([
            dropMirrorStatement('beefy_v13__ch_10').text,
            pgSql`create schema ${pgIdent('beefy_v13__ch_10')}`.text,
            createTableStatement('beefy_v13__ch_10', 'TimelineEvent', columns).text,
        ]);
        expect(copies).toHaveLength(1);
        expect(selects[0]?.params).toEqual({ p_0: 10, p_1: 10 });
    });
});
