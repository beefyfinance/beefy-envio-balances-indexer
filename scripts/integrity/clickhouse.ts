/**
 * ClickHouse HTTP client for the local Envio sink (`ENVIO_CLICKHOUSE_*`).
 * Tables match the GraphQL entity names (`Classic`, `Clm`, …) with snake_case columns.
 */

export type ClickHouseClient = {
    query<T extends Record<string, unknown>>(sql: string): Promise<T[]>;
};

export type ClickHouseConfig = {
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

export const fetchIds = async (client: ClickHouseClient, table: string, chainIds: number[]): Promise<Set<string>> => {
    const rows = await client.query<{ id: string }>(`SELECT id FROM ${table} WHERE ${chainIn('chain_id', chainIds)}`);
    return new Set(rows.map((row) => row.id));
};
