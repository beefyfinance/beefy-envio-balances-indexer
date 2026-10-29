import { createHash, randomBytes } from 'node:crypto';

import { type Schema, type Sql, type SqlInt, ident, int, param, qualified, qualifiedName, sql } from './sql.ts';
import { apiViewNames } from './timeline.ts';

/** The two ClickHouse users this project needs, and what each may do. */
export const defaultPipelineUser = (): string => 'beefy_pipeline';
export const defaultApiUser = (): string => 'beefy_api';

export type AccessOptions = {
    pipelineUser?: string;
    apiUser?: string;
    pipelinePassword: string;
    apiPassword: string;
    /** The common prefix of Envio's version databases (`envio_dev_mrt_` for `envio_dev_mrt_<N>`): read and dropped by the worker. */
    envioDatabasePrefix: string;
};

/** The API user's profile: a readonly user cannot raise any of these. */
const API_LIMITS = {
    maxExecutionSeconds: 3,
    maxRowsToRead: 2_000_000,
    maxBytesToRead: 268_435_456,
    maxMemoryBytes: 1_000_000_000,
    maxThreads: 4,
    maxConcurrentQueries: 16,
    queriesPerMinute: 3000,
    rowsReadPerMinute: 3_000_000_000,
};
/**
 * The pipeline profile's caps. The worker and the CLI send their own, lower, limits with each reprice statement
 * (`REPRICE_MAX_MEMORY_MB`, `REPRICE_MAX_EXECUTION_SECONDS`): those must fit under these, or ClickHouse refuses the
 * statement.
 */
const PIPELINE_MAX_MEMORY_BYTES = 8_000_000_000;
const PIPELINE_MAX_EXECUTION_SECONDS = 600;
const PIPELINE_MAX_THREADS = 4;
const PIPELINE_MAX_ROWS_TO_READ = 2_000_000_000;
const PIPELINE_MAX_CONCURRENT_QUERIES = 8;
const MIN_PASSWORD_LENGTH = 16;

/** A setting's value in a profile, where ClickHouse takes no query parameter: a non-negative integer, checked. */
const limit = (value: number): SqlInt => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid limit: ${JSON.stringify(value)}`);
    return int(value);
};

/**
 * What `IDENTIFIED WITH sha256_hash BY <hash> SALT <salt>` takes: a random salt per user and the SHA-256 of the password
 * followed by it. The password itself never travels, and two users (or two environments) with the same password do not
 * get the same stored hash.
 */
const passwordHash = (
    name: string,
    value: string,
    salt = randomBytes(16).toString('hex')
): { hash: string; salt: string } => {
    if (value.length < MIN_PASSWORD_LENGTH)
        throw new Error(`${name} must be at least ${MIN_PASSWORD_LENGTH} characters`);
    return {
        hash: createHash('sha256')
            .update(value + salt, 'utf8')
            .digest('hex'),
        salt,
    };
};

const identifiedBy = (name: string, value: string): Sql => {
    const { hash, salt } = passwordHash(name, value);
    return sql`IDENTIFIED WITH sha256_hash BY ${param('String', hash)} SALT ${param('String', salt)}`;
};

/**
 * Users, settings profiles and quotas, to run once by an administrator (it needs access management).
 *
 * `beefy_pipeline` is the worker and the CLI: it creates and drops the version tables and the API views in our stable
 * database, reads Envio's version databases and drops them on cleanup (a prefix grant, `envio_<env>_*`), and reads the
 * price tables. It is also the DEFINER of the API views (`SQL SECURITY DEFINER`), so the API user needs no grant on what
 * they read. Its profile leaves room for the reprice statements (minutes, not seconds).
 *
 * `beefy_api` can only read the API views (`user_timeline_api`, `product_contracts_api`, `api_status`), is readonly and
 * cannot raise its own limits: a heavy account is stopped by its profile, and the API returns the error. Its profile also
 * makes ClickHouse return Arrow uncompressed (the API refuses compressed buffers; a readonly user cannot ask per query).
 * `CREATE ... IF NOT EXISTS` leaves an existing profile as it is: change it with `ALTER SETTINGS PROFILE`.
 *
 * Passwords travel as parameters: their salted SHA-256 hash and the salt; names go through `ident`. To change a
 * password, `ALTER USER <name> IDENTIFIED WITH sha256_hash BY <hash> SALT <salt>` (`CREATE USER IF NOT EXISTS` leaves
 * an existing user as it is).
 */
export const accessStatements = (schema: Pick<Schema, 'database' | 'prices'>, options: AccessOptions): Sql[] => {
    const pipelineName = options.pipelineUser ?? defaultPipelineUser();
    const apiName = options.apiUser ?? defaultApiUser();
    const pipeline = ident(pipelineName);
    const api = ident(apiName);
    const database = ident(schema.database);
    const pipelineProfile = ident(`${pipelineName}_profile`);
    const apiProfile = ident(`${apiName}_profile`);
    const apiQuota = ident(`${apiName}_quota`);
    const memory = limit(PIPELINE_MAX_MEMORY_BYTES);
    const seconds = limit(PIPELINE_MAX_EXECUTION_SECONDS);
    return [
        sql`CREATE DATABASE IF NOT EXISTS ${database}`,
        sql`CREATE SETTINGS PROFILE IF NOT EXISTS ${pipelineProfile} SETTINGS
    max_threads = ${limit(PIPELINE_MAX_THREADS)} MAX ${limit(PIPELINE_MAX_THREADS)}, max_memory_usage = ${memory} MAX ${memory},
    max_execution_time = ${seconds} MAX ${seconds},
    max_rows_to_read = ${limit(PIPELINE_MAX_ROWS_TO_READ)} MAX ${limit(PIPELINE_MAX_ROWS_TO_READ)},
    max_concurrent_queries_for_user = ${limit(PIPELINE_MAX_CONCURRENT_QUERIES)}`,
        sql`CREATE USER IF NOT EXISTS ${pipeline} ${identifiedBy('pipelinePassword', options.pipelinePassword)}
    DEFAULT DATABASE ${database} SETTINGS PROFILE ${pipelineProfile}`,
        sql`GRANT SELECT, INSERT, CREATE DATABASE, CREATE TABLE, CREATE VIEW, DROP TABLE, DROP VIEW, TRUNCATE, OPTIMIZE
    ON ${database}.* TO ${pipeline}`,
        // a prefix grant: the quoted prefix, then the wildcard
        sql`GRANT SELECT, DROP DATABASE, DROP TABLE, DROP VIEW ON ${ident(options.envioDatabasePrefix)}*.* TO ${pipeline}`,
        ...[schema.prices.price5m, schema.prices.token].map(
            (table) => sql`GRANT SELECT ON ${qualifiedName(table)} TO ${pipeline}`
        ),
        // readonly = 1: reads only, and a request cannot change any setting (the client sends none)
        sql`CREATE SETTINGS PROFILE IF NOT EXISTS ${apiProfile} SETTINGS
    readonly = 1, max_execution_time = ${limit(API_LIMITS.maxExecutionSeconds)} MAX ${limit(API_LIMITS.maxExecutionSeconds)},
    max_rows_to_read = ${limit(API_LIMITS.maxRowsToRead)} MAX ${limit(API_LIMITS.maxRowsToRead)},
    max_bytes_to_read = ${limit(API_LIMITS.maxBytesToRead)} MAX ${limit(API_LIMITS.maxBytesToRead)},
    max_memory_usage = ${limit(API_LIMITS.maxMemoryBytes)} MAX ${limit(API_LIMITS.maxMemoryBytes)},
    max_threads = ${limit(API_LIMITS.maxThreads)} MAX ${limit(API_LIMITS.maxThreads)},
    max_concurrent_queries_for_user = ${limit(API_LIMITS.maxConcurrentQueries)},
    output_format_arrow_compression_method = 'none'`,
        sql`CREATE USER IF NOT EXISTS ${api} ${identifiedBy('apiPassword', options.apiPassword)}
    DEFAULT DATABASE ${database} SETTINGS PROFILE ${apiProfile}`,
        ...apiViewNames().map((view) => sql`GRANT SELECT ON ${qualified(schema.database, view)} TO ${api}`),
        sql`CREATE QUOTA IF NOT EXISTS ${apiQuota} FOR INTERVAL 1 minute
    MAX queries = ${limit(API_LIMITS.queriesPerMinute)}, read_rows = ${limit(API_LIMITS.rowsReadPerMinute)} TO ${api}`,
    ];
};
