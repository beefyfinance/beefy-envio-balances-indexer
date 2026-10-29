import {
    type ClickhouseConfig,
    ConfigError,
    clickhousePipeline,
    type Env,
    oneOf,
    optionalString,
    parseEnv,
    type RepriceConfig,
    repriceSettings,
} from '@beefy/config';

/**
 * The CLI's configuration, and the only place of this package that reads `process.env` ({@link readConfig}). Everything
 * is parsed and checked at startup: a missing or invalid value stops the process before any command runs.
 */
export type CliConfig = {
    clickhouse: ClickhouseConfig;
    reprice: RepriceConfig;
    /** `access` only: the users' passwords (at least 16 characters, checked when used). */
    pipelinePassword: string | undefined;
    apiPassword: string | undefined;
    /** `seed-synthetic` writes fake data: only with `ALLOW_SYNTHETIC=yes`. */
    allowSynthetic: boolean;
};

const optional =
    (name: string) =>
    (env: Env, problems: string[]): string | undefined => {
        const value = optionalString(name, '')(env, problems);
        return value === '' ? undefined : value;
    };

export const loadConfig = (env: Env): CliConfig =>
    parseEnv(env, {
        clickhouse: clickhousePipeline(),
        reprice: repriceSettings(),
        pipelinePassword: optional('PIPELINE_PASSWORD'),
        apiPassword: optional('API_PASSWORD'),
        allowSynthetic: (e: Env, problems: string[]): boolean =>
            oneOf('ALLOW_SYNTHETIC', ['yes', 'no'], 'no')(e, problems) === 'yes',
    });

/** {@link loadConfig} of the process environment; on a problem, says what is wrong and exits. */
export const readConfig = (): CliConfig => {
    try {
        return loadConfig(process.env);
    } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    }
};

/** The scratch ClickHouse the integration tests use (`CLICKHOUSE_URL`); they are skipped without one. */
export const integrationClickhouseUrl = (): string | undefined => process.env['CLICKHOUSE_URL'];
