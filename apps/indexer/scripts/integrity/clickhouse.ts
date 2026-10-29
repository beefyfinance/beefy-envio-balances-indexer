/**
 * ClickHouse HTTP client for the local Envio sink (ENVIO_CLICKHOUSE_*, scripts/lib/config.ts).
 * Tables match the GraphQL entity names (`Contract`, `TimelineEvent`, …) with snake_case columns.
 *
 * Statements are built with the `sql` tag of `@beefy/clickhouse`: values travel as query parameters (`{p_<n>:Type}` in
 * the SQL, encoded by scripts/lib/sql.ts), table names through `ident`, and every row is validated with the caller's
 * zod schema.
 */
import { type Identifier, type Sql, ident, isSql, param, sql } from '@beefy/clickhouse';
import * as R from 'remeda';
import { z } from 'zod';

import type { ClickHouseConfig } from '../lib/config.ts';
import { paramEntries } from '../lib/sql.ts';

export type ClickHouseClient = {
    /** Rows of `statement` (JSONEachRow), each validated by `row`; a row of another shape throws. */
    query<T>(statement: Sql, row: z.ZodType<T>): Promise<T[]>;
};

export const createClickHouseClient = (config: ClickHouseConfig): ClickHouseClient => ({
    async query<T>(statement: Sql, row: z.ZodType<T>): Promise<T[]> {
        if (!isSql(statement)) throw new Error('not a SQL statement: build it with the sql tag');
        const request = sql`${statement}\nFORMAT JSONEachRow`;
        const endpoint = new URL(config.url);
        endpoint.searchParams.set('database', config.database);
        for (const [name, value] of paramEntries(request.params)) endpoint.searchParams.set(name, value);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'x-clickhouse-user': config.username,
                'x-clickhouse-key': config.password,
            },
            body: request.text,
        });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`ClickHouse query failed: ${response.status} ${text.slice(0, 500)}`);
        }
        return R.pipe(
            text.split('\n'),
            R.filter((line) => line.trim() !== ''),
            R.map((line, index) => {
                const parsed = row.safeParse(JSON.parse(line));
                if (!parsed.success) {
                    throw new Error(`ClickHouse row ${index + 1} has an unexpected shape: ${parsed.error.message}`);
                }
                return parsed.data;
            })
        );
    },
});

/** A table of the indexer database, quoted. */
export const table = (name: string): Identifier => ident(name);

/** `chain_id` (of `alias`) among `chainIds`, a parameter. */
export const inChains = (chainIds: readonly number[], alias?: string): Sql =>
    sql`has(${param('Array(Int64)', chainIds)}, toInt64(${alias === undefined ? sql`` : sql`${ident(alias)}.`}chain_id))`;

const idRow = z.object({ id: z.string() });

/** Ids of the rows of `tableName` on `chainIds`, filtered by `where` (SQL over the table's columns). */
export const fetchIds = async (
    client: ClickHouseClient,
    tableName: string,
    chainIds: readonly number[],
    where: Sql = sql`1`
): Promise<Set<string>> => {
    const rows = await client.query(
        sql`SELECT id FROM ${table(tableName)} WHERE ${inChains(chainIds)} AND (${where})`,
        idRow
    );
    return new Set(R.map(rows, (row) => row.id));
};

/** Ids of the `Contract` rows of the given kinds. */
export const fetchContractIds = (client: ClickHouseClient, kinds: readonly string[], chainIds: readonly number[]) =>
    fetchIds(client, 'Contract', chainIds, sql`has(${param('Array(String)', kinds)}, toString(kind))`);
