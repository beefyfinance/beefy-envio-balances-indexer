import { type Env, group, optionalString, parseEnv, requiredUrl } from './env.ts';

export type ClickhouseConfig = {
    url: string;
    username: string;
    password: string;
    /** Written by the indexer. Envio truncates or drops this database on a reindex: never put anything of ours in it. */
    rawDatabase: string;
    /** Owned by us: price tables, materialized views, valued positions. Survives an indexer reindex. */
    analyticsDatabase: string;
    /** The databarn dbt database holding `int_product_share_price`. Read only. */
    priceDatabase: string;
};

/** Composable into an app's own env shape, so all problems are reported together. */
export const clickhouseReader = group(
    {
        url: requiredUrl('CLICKHOUSE_URL', ['http:', 'https:']),
        username: optionalString('CLICKHOUSE_USERNAME', 'default'),
        password: optionalString('CLICKHOUSE_PASSWORD', ''),
        rawDatabase: optionalString('CLICKHOUSE_RAW_DATABASE', 'beefy_raw'),
        analyticsDatabase: optionalString('CLICKHOUSE_ANALYTICS_DATABASE', 'beefy_analytics'),
        priceDatabase: optionalString('CLICKHOUSE_PRICE_DATABASE', 'dbt'),
    },
    (value, problems) => {
        if (value.rawDatabase === value.analyticsDatabase) {
            problems.push(
                'CLICKHOUSE_ANALYTICS_DATABASE must differ from CLICKHOUSE_RAW_DATABASE (Envio drops the raw one)'
            );
        }
    }
);

export const clickhouseConfigFromEnv = (env: Env): ClickhouseConfig =>
    parseEnv(env, { clickhouse: clickhouseReader }).clickhouse;
