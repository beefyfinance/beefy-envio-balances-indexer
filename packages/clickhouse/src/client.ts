/** A deliberately small ClickHouse client over the HTTP interface: no dependency, JSON in and out, errors carry the server text. */
export type ClickhouseConnection = { url: string; username: string; password: string };

export type ClickhouseSettings = Record<string, string | number>;

export type RequestOptions = { timeoutMs?: number };

export type ClickhouseClient = {
    /** Runs a SELECT and returns its rows. */
    query: <Row>(sql: string, settings?: ClickhouseSettings, options?: RequestOptions) => Promise<Row[]>;
    /** Runs a statement that returns nothing (DDL, INSERT ... SELECT). */
    command: (sql: string, settings?: ClickhouseSettings, options?: RequestOptions) => Promise<void>;
};

export class ClickhouseError extends Error {
    readonly status: number;
    constructor(status: number, body: string) {
        super(`ClickHouse ${status}: ${body.trim().slice(0, 600)}`);
        this.name = 'ClickhouseError';
        this.status = status;
    }
}

const REQUEST_TIMEOUT_MS = 120_000;

export const createClickhouseClient = (
    connection: ClickhouseConnection,
    fetchImpl: typeof fetch = fetch
): ClickhouseClient => {
    const send = async (sql: string, settings: ClickhouseSettings, options: RequestOptions): Promise<string> => {
        const url = new URL(connection.url);
        for (const [key, value] of Object.entries({ wait_end_of_query: 1, ...settings })) {
            url.searchParams.set(key, String(value));
        }
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'X-ClickHouse-User': connection.username, 'X-ClickHouse-Key': connection.password },
            body: sql,
            signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
        });
        const body = await response.text();
        if (!response.ok) {
            throw new ClickhouseError(response.status, body);
        }
        return body;
    };

    return {
        query: async <Row>(sql: string, settings: ClickhouseSettings = {}, options: RequestOptions = {}) => {
            const body = await send(
                `${sql}\nFORMAT JSONEachRow`,
                { output_format_json_quote_64bit_integers: 1, ...settings },
                options
            );
            return body
                .split('\n')
                .filter((line) => line !== '')
                .map((line) => JSON.parse(line) as Row);
        },
        command: async (sql, settings = {}, options = {}) => {
            await send(sql, settings, options);
        },
    };
};
