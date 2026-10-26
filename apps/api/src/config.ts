import { type ClickhouseConfig, clickhouseReader, type Env, integer, parseEnv } from '@beefy/config';

export type ApiConfig = {
    port: number;
    clickhouse: ClickhouseConfig;
};

export const loadConfig = (env: Env): ApiConfig =>
    parseEnv(env, {
        port: integer('PORT', 3000, { min: 1, max: 65535 }),
        clickhouse: clickhouseReader,
    });
