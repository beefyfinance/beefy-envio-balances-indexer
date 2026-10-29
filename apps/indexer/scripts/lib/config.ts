/**
 * Configuration of the scripts (scripts/*.ts, scripts/integrity/*): the only module of the scripts that reads
 * `process.env`. Each script calls {@link scriptsConfig} first thing, so an invalid value stops it before it does
 * anything, with every problem listed. Command-line options (commander) override some of these per run.
 *
 * Variables (all optional; .env.example documents them):
 * - ENVIO_RPC_URL_<chainId>: RPC per chain (knownContracts, correctness default), http(s) URLs.
 * - BEEFY_API_URL: Beefy API (knownContracts, integrity catalog).
 * - ENVIO_PG_HOST / PORT / USER / PASSWORD / DATABASE, ENVIO_PG_SCHEMA, PSQL: Postgres, read with psql (correctness).
 * - ENVIO_CLICKHOUSE_HOST / DATABASE / USERNAME / PASSWORD: ClickHouse over HTTP (integrity).
 */
import * as R from 'remeda';
import { z } from 'zod';

import {
    type Env,
    hostVar,
    identifierVar,
    intVar,
    optionalUrlVar,
    parseEnv,
    stringVar,
    urlVar,
} from '../../src/lib/env.ts';

export type PostgresConfig = { host: string; port: number; user: string; password: string; database: string };
export type ClickHouseConfig = { url: string; database: string; username: string; password: string };

export type ScriptsConfig = {
    /** RPC endpoint per chain id, from every ENVIO_RPC_URL_<chainId> set. */
    rpcUrls: ReadonlyMap<number, string>;
    beefyApiUrl: string;
    postgres: PostgresConfig;
    /** Default Postgres schema of the indexer tables (correctness `--schema`). */
    postgresSchema: string;
    /** psql binary. */
    psql: string;
    clickhouse: ClickHouseConfig;
};

const RPC_URL_VAR = /^ENVIO_RPC_URL_(\d+)$/;

/** Parses and validates the scripts' configuration from `env`; throws a ConfigError listing every problem. */
export const loadScriptsConfig = (env: Env): ScriptsConfig => {
    const rpcUrlVars = R.pipe(
        R.keys(env),
        R.filter((name) => RPC_URL_VAR.test(name))
    );
    const parsed = parseEnv(
        z.object({
            ...R.fromEntries(R.map(rpcUrlVars, (name) => [name, optionalUrlVar()] as const)),
            BEEFY_API_URL: urlVar('https://api.beefy.finance'),
            ENVIO_PG_HOST: hostVar('localhost'),
            ENVIO_PG_PORT: intVar(5433, { min: 1, max: 65_535 }),
            ENVIO_PG_USER: stringVar('postgres'),
            ENVIO_PG_PASSWORD: stringVar('testing'),
            ENVIO_PG_DATABASE: z.preprocess(
                (value) => (value === '' ? undefined : value),
                z
                    .string()
                    .regex(/^[A-Za-z0-9_.-]+$/, 'must be a database name ([A-Za-z0-9_.-])')
                    .default('envio-dev')
            ),
            ENVIO_PG_SCHEMA: identifierVar('public'),
            PSQL: stringVar('psql'),
            ENVIO_CLICKHOUSE_HOST: urlVar('http://localhost:8123'),
            ENVIO_CLICKHOUSE_DATABASE: identifierVar('default'),
            ENVIO_CLICKHOUSE_USERNAME: stringVar('default'),
            ENVIO_CLICKHOUSE_PASSWORD: stringVar(''),
        }),
        env
    );
    const values = parsed as Record<string, unknown>;
    return {
        rpcUrls: new Map(
            R.pipe(
                rpcUrlVars,
                R.map((name) => [Number(RPC_URL_VAR.exec(name)?.[1]), values[name]] as const),
                R.filter((entry): entry is readonly [number, string] => typeof entry[1] === 'string')
            )
        ),
        beefyApiUrl: parsed.BEEFY_API_URL.replace(/\/+$/, ''),
        postgres: {
            host: parsed.ENVIO_PG_HOST,
            port: parsed.ENVIO_PG_PORT,
            user: parsed.ENVIO_PG_USER,
            password: parsed.ENVIO_PG_PASSWORD,
            database: parsed.ENVIO_PG_DATABASE,
        },
        postgresSchema: parsed.ENVIO_PG_SCHEMA,
        psql: parsed.PSQL,
        clickhouse: {
            url: parsed.ENVIO_CLICKHOUSE_HOST,
            database: parsed.ENVIO_CLICKHOUSE_DATABASE,
            username: parsed.ENVIO_CLICKHOUSE_USERNAME,
            password: parsed.ENVIO_CLICKHOUSE_PASSWORD,
        },
    };
};

let loaded: ScriptsConfig | undefined;

/** The configuration of this run, parsed from `process.env` at the first call (a script's first statement). */
export const scriptsConfig = (): ScriptsConfig => {
    loaded ??= loadScriptsConfig(process.env);
    return loaded;
};

/** The environment of a child process (psql): this one's, plus `extra` (PGPASSWORD). */
export const childProcessEnv = (extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv => ({
    ...process.env,
    ...extra,
});
