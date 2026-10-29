import { type Env, group, integer, optionalString, parseEnv, requiredString, requiredUrl } from './env.ts';

/** What a process that only reads our own database needs (the API). */
export type ClickhouseReaderConfig = {
    url: string;
    username: string;
    password: string;
    /**
     * Owned by us and never dropped: `deployments`, the API's views, and every version's tables (suffixed `_<N>`). The
     * Envio database of each version is recorded in `deployments`, not configured.
     */
    analyticsDatabase: string;
};

/** The databarn tables prices are read from. Read only (written by tests and dev seeds). */
export type PriceTablesConfig = {
    /** `database.table` of the 5 minute prices (`analytics.asset_price_5m`: asset_id, date_time, price, price_source). */
    price5mTable: string;
    /** `database.table` mapping a token (chain, address) to its price asset (`analytics.token`). */
    tokenTable: string;
};

/** What a process that builds and feeds our database needs (the CLI, the worker). */
export type ClickhouseConfig = ClickhouseReaderConfig &
    PriceTablesConfig & {
        /**
         * `price_source` values of the 5 minute table the watermark waits for: it only moves past a time once each of
         * them has prices that far (minus the max price gap).
         */
        watermarkPriceSources: string[];
        /** The user the API views run as (`SQL SECURITY DEFINER`); undefined in tests and local setups. */
        definer: string | undefined;
        /**
         * The common prefix of Envio's version databases (`envio_dev_mrt_` for `envio_dev_mrt_<N>`). Version N may only be
         * deployed on `<prefix><N>`, and cleanup drops nothing else: a database registered by mistake is never dropped.
         */
        envioDatabasePrefix: string;
    };

/** How the reprice statements are sized and limited, and the windows around the watermark (the worker and the CLI). */
export type RepriceConfig = {
    /** The longest time range one reprice statement covers; the watermark is written after each. */
    stepDays: number;
    /** The most events one reprice statement prices: a time range with more is split. */
    maxEventsPerStatement: number;
    /** Per statement limits, sent with each reprice statement (within the pipeline user's profile). */
    maxMemoryBytes: number;
    maxExecutionSeconds: number;
    /** Every advance retries the rows of this many days below the watermark that are not final. */
    retryDays: number;
    /** An event older than this with no price at all blocks `ready` and `switch`. */
    pendingGraceSeconds: number;
    /** The watermark stays at least this far behind now: the prices of the last day can still change. */
    watermarkMinAgeSeconds: number;
    /** Retired versions are kept this long before cleanup drops them. */
    cleanupGraceHours: number;
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;
const SOURCE_NAME = /^[A-Za-z0-9_.-]+$/;

const readerShape = {
    url: requiredUrl('CLICKHOUSE_URL', ['http:', 'https:']),
    // no fallback to the `default` user: every process names the user it runs as
    username: requiredString('CLICKHOUSE_USERNAME'),
    password: optionalString('CLICKHOUSE_PASSWORD', ''),
    analyticsDatabase: optionalString('CLICKHOUSE_ANALYTICS_DATABASE', 'beefy_analytics'),
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const checkDatabase = (
    value: { url: string; password: string; analyticsDatabase: string },
    problems: string[]
): void => {
    // it ends up in statements (quoted, but only plain names are accepted there)
    if (!IDENTIFIER.test(value.analyticsDatabase)) {
        problems.push('CLICKHOUSE_ANALYTICS_DATABASE must be a plain identifier (A-Z a-z 0-9 _)');
    }
    // an empty password is for a local ClickHouse only (docker-compose, CI)
    if (value.password === '' && URL.canParse(value.url) && !LOOPBACK_HOSTS.has(new URL(value.url).hostname)) {
        problems.push('CLICKHOUSE_PASSWORD is required for a ClickHouse that is not on localhost');
    }
};

/** The connection and our database. Composable into an app's own env shape, so all problems are reported together. */
export const clickhouseReader = () => group(readerShape, checkDatabase);

const commaList =
    (name: string, fallback: string) =>
    (env: Env): string[] =>
        optionalString(name, fallback)(env, [])
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item !== '');

/**
 * The pipeline user may drop any database starting with the prefix, and cleanup drops `<prefix><N>`: the prefix must be
 * specific enough to never cover a database of ours or the price tables'. Two environments sharing one ClickHouse
 * need different prefixes (their version numbers collide).
 */
const checkEnvioPrefix = (
    value: { envioDatabasePrefix: string; analyticsDatabase: string; price5mTable: string; tokenTable: string },
    problems: string[]
): void => {
    const prefix = value.envioDatabasePrefix;
    if (prefix === '') return;
    if (!IDENTIFIER.test(prefix) || prefix.length < 4 || !prefix.endsWith('_')) {
        problems.push(
            'CLICKHOUSE_ENVIO_DATABASE_PREFIX must be an identifier prefix (A-Z a-z 0-9 _) of at least 4 characters ending with _'
        );
        return;
    }
    const ours = [value.analyticsDatabase, value.price5mTable.split('.')[0], value.tokenTable.split('.')[0]];
    for (const database of ours) {
        if (database !== undefined && database.startsWith(prefix)) {
            problems.push(`CLICKHOUSE_ENVIO_DATABASE_PREFIX must not be a prefix of ${database}`);
        }
    }
};

/** Reader plus the price tables, the watermark's price sources, the views' definer and Envio's database prefix. */
export const clickhousePipeline = () =>
    group(
        {
            ...readerShape,
            price5mTable: optionalString('CLICKHOUSE_PRICE_5M_TABLE', 'analytics.asset_price_5m'),
            tokenTable: optionalString('CLICKHOUSE_TOKEN_TABLE', 'analytics.token'),
            watermarkPriceSources: commaList('CLICKHOUSE_WATERMARK_PRICE_SOURCES', 'api,beefy_db'),
            definer: (env: Env): string | undefined => {
                const value = optionalString('CLICKHOUSE_DEFINER', '')(env, []);
                return value === '' ? undefined : value;
            },
            envioDatabasePrefix: requiredString('CLICKHOUSE_ENVIO_DATABASE_PREFIX'),
        },
        (value, problems) => {
            checkDatabase(value, problems);
            for (const [name, table] of [
                ['CLICKHOUSE_PRICE_5M_TABLE', value.price5mTable],
                ['CLICKHOUSE_TOKEN_TABLE', value.tokenTable],
            ] as const) {
                if (!TABLE_NAME.test(table)) problems.push(`${name} must be database.table`);
            }
            if (
                value.watermarkPriceSources.length === 0 ||
                !value.watermarkPriceSources.every((s) => SOURCE_NAME.test(s))
            ) {
                problems.push('CLICKHOUSE_WATERMARK_PRICE_SOURCES must be a comma separated list of A-Z a-z 0-9 _ . -');
            }
            if (value.definer !== undefined && !IDENTIFIER.test(value.definer)) {
                problems.push('CLICKHOUSE_DEFINER must be a plain user name');
            }
            checkEnvioPrefix(value, problems);
        }
    );

/** {@link RepriceConfig} from the environment, with the defaults the worker and the CLI share. */
export const repriceSettings = () =>
    group({
        stepDays: integer('ADVANCE_STEP_DAYS', 7, { min: 1, max: 366 }),
        // a statement's memory grows with its events (the deduplication) and its price points (assets times days)
        maxEventsPerStatement: integer('REPRICE_MAX_EVENTS', 500_000, { min: 1000, max: 100_000_000 }),
        maxMemoryBytes: (env: Env, problems: string[]): number =>
            integer('REPRICE_MAX_MEMORY_MB', 4096, { min: 64, max: 1_048_576 })(env, problems) * 1024 * 1024,
        maxExecutionSeconds: integer('REPRICE_MAX_EXECUTION_SECONDS', 600, { min: 10, max: 86_400 }),
        retryDays: integer('REPRICE_RETRY_DAYS', 7, { min: 1, max: 90 }),
        pendingGraceSeconds: (env: Env, problems: string[]): number =>
            integer('PENDING_GRACE_MINUTES', 15, { min: 1, max: 24 * 60 })(env, problems) * 60,
        watermarkMinAgeSeconds: (env: Env, problems: string[]): number =>
            integer('WATERMARK_MIN_AGE_HOURS', 24, { min: 1, max: 24 * 30 })(env, problems) * 3600,
        cleanupGraceHours: integer('CLEANUP_GRACE_HOURS', 48, { min: 1, max: 24 * 90 }),
    });

export const clickhouseConfigFromEnv = (env: Env): ClickhouseConfig =>
    parseEnv(env, { clickhouse: clickhousePipeline() }).clickhouse;
