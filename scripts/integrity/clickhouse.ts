/**
 * ClickHouse HTTP client for the local Envio sink (`ENVIO_CLICKHOUSE_*`).
 * Tables match the GraphQL entity names (`Contract`, `BalanceChange`, …) with snake_case columns.
 */

export type ClickHouseClient = {
    query<T extends Record<string, unknown>>(sql: string): Promise<T[]>;
};

type ClickHouseConfig = {
    url: string;
    database: string;
    username: string;
    password: string;
};

export const clickHouseConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): ClickHouseConfig => ({
    url: env.ENVIO_CLICKHOUSE_HOST ?? 'http://localhost:8123',
    database: env.ENVIO_CLICKHOUSE_DATABASE ?? 'default',
    username: env.ENVIO_CLICKHOUSE_USERNAME ?? 'default',
    password: env.ENVIO_CLICKHOUSE_PASSWORD ?? '',
});

export const createClickHouseClient = (config: ClickHouseConfig): ClickHouseClient => {
    const endpoint = new URL(config.url);
    endpoint.searchParams.set('database', config.database);
    return {
        async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'x-clickhouse-user': config.username,
                    'x-clickhouse-key': config.password,
                },
                body: `${sql.trim()}\nFORMAT JSONEachRow`,
            });
            const text = await response.text();
            if (!response.ok) {
                throw new Error(`ClickHouse query failed: ${response.status} ${text.slice(0, 500)}`);
            }
            if (text.trim() === '') {
                return [];
            }
            return text
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as T);
        },
    };
};

export const chainIn = (column: string, chainIds: number[]) => `${column} IN (${chainIds.join(',')})`;

/** `column IN ('a','b')` for ids / enum values (only `[\w.-]` characters accepted, so nothing needs escaping). */
export const sqlStringIn = (column: string, values: readonly string[]) => {
    if (values.length === 0) {
        return '0';
    }
    const literals = values.map((value) => {
        if (!/^[\w.-]+$/.test(value)) {
            throw new Error(`Unexpected SQL literal: ${value}`);
        }
        return `'${value}'`;
    });
    return `${column} IN (${literals.join(',')})`;
};

export const fetchIds = async (
    client: ClickHouseClient,
    table: string,
    chainIds: number[],
    where = '1'
): Promise<Set<string>> => {
    const rows = await client.query<{ id: string }>(
        `SELECT id FROM ${table} WHERE ${chainIn('chain_id', chainIds)} AND (${where})`
    );
    return new Set(rows.map((row) => row.id));
};

/** Ids of the `Contract` rows of the given kinds. */
export const fetchContractIds = (client: ClickHouseClient, kinds: readonly string[], chainIds: number[]) =>
    fetchIds(client, 'Contract', chainIds, sqlStringIn('kind', kinds));
