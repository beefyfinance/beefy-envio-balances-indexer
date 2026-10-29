import type { Readable } from 'node:stream';

import { type ClickHouseClient, ClickHouseError, type ClickHouseSettings, createClient } from '@clickhouse/client';
import * as R from 'remeda';

import { type Identifier, type Sql, isIdentifier, isSql } from './sql.ts';

/**
 * A thin layer over the official client (`@clickhouse/client`), which does the transport: query parameters
 * (`query_params`, formatted and escaped by the client), per query settings, keep-alive connections, inserts, errors.
 * What this layer adds: statements only as {@link Sql} values (built by the `sql` tag: the text and its parameters
 * together), tables only as checked {@link Identifier}s, one options shape for every call, a timeout per call,
 * `query_log` tags (`log_comment`), JSON that writes bigints, and error messages that carry ClickHouse's error type.
 */
export type ClickhouseConnection = {
    url: string;
    username: string;
    password: string;
    /**
     * A readonly user (the API's): no setting at all is sent, since such a user refuses any, even one set to its default.
     * Otherwise statements are answered once they end (`wait_end_of_query`), so an error is never hidden behind a
     * response already started.
     */
    readonly?: boolean;
};

export type ClickhouseSettings = Readonly<Record<string, string | number>>;

export type RequestOptions = {
    /** Per query settings (never for a readonly user). */
    settings?: ClickhouseSettings;
    timeoutMs?: number;
    /** Tags the query in `system.query_log` (`log_comment`, a setting: never for a readonly user). */
    comment?: string;
};

export type ClickhouseClient = {
    /** Runs a SELECT and returns its rows (`JSONEachRow`). */
    query: <Row>(statement: Sql, options?: RequestOptions) => Promise<Row[]>;
    /** Runs a SELECT (with its own `FORMAT` clause) and returns the raw response stream (`ArrowStream` for the API). */
    stream: (statement: Sql, options?: RequestOptions) => Promise<Readable>;
    /** Runs a statement that returns nothing (DDL, INSERT ... SELECT). */
    command: (statement: Sql, options?: RequestOptions) => Promise<void>;
    /** Inserts rows (objects keyed by column) into `table` (`qualified(database, table)`), as JSON lines. */
    insert: (table: Identifier, rows: readonly Record<string, unknown>[], options?: RequestOptions) => Promise<void>;
    close: () => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 120_000;
/** The client's own request timeout: each call sets its own, shorter one (`timeoutMs`). */
const MAX_TIMEOUT_MS = 24 * 3_600_000;

/** JSON that writes a bigint as its decimal string (what ClickHouse parses for any integer column). */
const stringify = (value: unknown): string =>
    JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? item.toString() : item));

/** The server's error type (e.g. `ACCESS_DENIED`) in front of its message, so logs say what kind of failure it was. */
const informative = (error: unknown): never => {
    if (error instanceof ClickHouseError) {
        error.message = `ClickHouse ${error.type ?? error.code}: ${error.message}`;
    }
    throw error;
};

export const createClickhouseClient = ({
    url,
    username,
    password,
    readonly = false,
}: ClickhouseConnection): ClickhouseClient => {
    const client: ClickHouseClient = createClient({
        url,
        username,
        password,
        request_timeout: MAX_TIMEOUT_MS,
        keep_alive: { enabled: true },
        // no response compression: Arrow bodies are read as they are, and a readonly user may not ask for it
        compression: { response: false, request: false },
        clickhouse_settings: readonly ? {} : { wait_end_of_query: 1 },
        json: { parse: JSON.parse, stringify },
    });
    /** The statement's text and parameters; a string cast to `Sql` is refused before anything is sent. */
    const statementOf = (statement: Sql) => {
        if (!isSql(statement)) throw new Error('not a SQL statement: build it with the sql tag');
        return {
            query: statement.text,
            ...(R.isEmpty(R.keys(statement.params)) ? {} : { query_params: statement.params }),
        };
    };
    const request = ({ settings, timeoutMs, comment }: RequestOptions) => ({
        clickhouse_settings: {
            ...settings,
            ...(comment === undefined ? {} : { log_comment: comment }),
        } as ClickHouseSettings,
        abort_signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return {
        query: async <Row>(statement: Sql, options: RequestOptions = {}) =>
            (
                await client
                    .query({ ...statementOf(statement), format: 'JSONEachRow', ...request(options) })
                    .catch(informative)
            ).json<Row>(),
        stream: async (statement, options = {}) =>
            (await client.exec({ ...statementOf(statement), ...request(options) }).catch(informative)).stream,
        command: async (statement, options = {}) => {
            await client.command({ ...statementOf(statement), ...request(options) }).catch(informative);
        },
        insert: async (table, rows, options = {}) => {
            if (!isIdentifier(table)) throw new Error('not an identifier: name the table with qualified()');
            if (rows.length === 0) return;
            await client
                .insert({ table: table.text, values: [...rows], format: 'JSONEachRow', ...request(options) })
                .catch(informative);
        },
        close: () => client.close(),
    };
};
