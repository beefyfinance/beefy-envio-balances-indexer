import type { RepriceConfig } from '@beefy/config';
import * as R from 'remeda';

import type { ClickhouseClient, ClickhouseSettings } from './client.ts';
import {
    committedFrontier,
    envioChainsTable,
    frontierParam,
    headColumns,
    timelineEventHistoryTable,
    timelineEventsCtes,
} from './events.ts';
import { finalPriceFlags, maxPriceGapSeconds, priceColumns, pricedEventsCtes } from './pricing.ts';
import { type PlannedRange, planRanges, type Range } from './ranges.ts';
import {
    type Identifier,
    type Schema,
    type Sql,
    databaseOf,
    envioDatabaseOf,
    envioDatabaseVersion,
    ident,
    join,
    msOf,
    param,
    qualified,
    qualifiedName,
    sql,
    timeOf,
    utcTime,
    versionNumber,
} from './sql.ts';
import {
    type ActiveVersion,
    apiViews,
    databaseName,
    eventPriceTable,
    eventPriceTableStatement,
    priceWatermarkTable,
    priceWatermarkTableStatement,
    versionOfTable,
    versionTables,
} from './timeline.ts';

/**
 * Versions side by side. A reindex is a new version N: Envio indexes into its own database `envio_<env>_N`, and our
 * stable database gets the version's tables (`event_price_<N>`, `price_watermark_<N>`). The API reads views that name
 * the active version; a switch redefines them in one statement each, and old versions are dropped by a cleanup that is
 * safe to rerun. Everything is recorded in `deployments`.
 *
 * Lifecycle: `building` (Envio indexes, the reprice job fills `event_price_<N>`) → `ready` (set explicitly once Envio is
 * at the chain head and the watermark is current) → `active` (the API views point at it) → `retired` (replaced; kept for
 * a grace period so a switch can be undone) → `dropped` (its tables, then its Envio database, are gone).
 *
 * Every statement is built by the `sql` tag (sql.ts): values are query parameters, names go through `ident`.
 */
export const deploymentsTable = (): string => 'deployments';

const DEPLOYMENT_STATES = ['building', 'ready', 'active', 'retired', 'dropped'] as const;
export type DeploymentState = (typeof DEPLOYMENT_STATES)[number];
export const deploymentStates = (): DeploymentState[] => [...DEPLOYMENT_STATES];

/** A row of `deployments`; times are UTC `YYYY-MM-DD HH:MM:SS.ffffff` strings, `null` for steps not reached. */
export type Deployment = {
    version: number;
    envioDatabase: string;
    state: DeploymentState;
    createdAt: string;
    readyAt: string | null;
    activatedAt: string | null;
    retiredAt: string | null;
    tablesDroppedAt: string | null;
    envioDroppedAt: string | null;
    updatedAt: string;
};

/** How the reprice statements are sized and limited, and the windows around the watermark (see `RepriceConfig`). */
export type RepriceSettings = Omit<RepriceConfig, 'cleanupGraceHours'>;

/** How far back the freshest price of each required source is looked for; a source silent for longer stops the watermark. */
const SOURCE_LOOKBACK_DAYS = 30;
/** Events are counted per hour to cut the time ranges a reprice statement covers. */
const COUNT_BUCKET_MS = 3_600_000;

/**
 * The settings sent with each reprice statement: the memory and time limits, and spilling to disk for the GROUP BY and
 * the sorts (the deduplication of the events, the window over the prices) past half the memory limit.
 */
const repriceQuerySettings = (settings: RepriceSettings): ClickhouseSettings => ({
    max_memory_usage: settings.maxMemoryBytes,
    max_execution_time: settings.maxExecutionSeconds,
    max_bytes_before_external_group_by: Math.floor(settings.maxMemoryBytes / 2),
    max_bytes_before_external_sort: Math.floor(settings.maxMemoryBytes / 2),
});

/**
 * The client waits a little longer than the server's `max_execution_time`: a client giving up earlier would leave the
 * statement running on the server, and the next advance would overlap it.
 */
const repriceTimeoutMs = (settings: Pick<RepriceSettings, 'maxExecutionSeconds'>): number =>
    (settings.maxExecutionSeconds + 30) * 1000;

const DEPLOYMENT_COLUMNS = [
    'version',
    'envio_database',
    'state',
    'created_at',
    'ready_at',
    'activated_at',
    'retired_at',
    'tables_dropped_at',
    'envio_dropped_at',
    'updated_at',
] as const;

export const deploymentsTableStatement = (schema: Pick<Schema, 'database'>): Sql => sql`
CREATE TABLE IF NOT EXISTS ${qualified(schema.database, deploymentsTable())}
(
    version UInt32,
    -- Envio's database of this version (envio_<env>_N); ours are the version's tables, event_price_<N> and price_watermark_<N>
    envio_database String,
    state Enum8('building' = 1, 'ready' = 2, 'active' = 3, 'retired' = 4, 'dropped' = 5),
    created_at DateTime64(6, 'UTC'),
    ready_at Nullable(DateTime64(6, 'UTC')),
    activated_at Nullable(DateTime64(6, 'UTC')),
    retired_at Nullable(DateTime64(6, 'UTC')),
    -- the cleanup steps, each recorded once done so a rerun skips it
    tables_dropped_at Nullable(DateTime64(6, 'UTC')),
    envio_dropped_at Nullable(DateTime64(6, 'UTC')),
    updated_at DateTime64(6, 'UTC')
)
-- every change inserts the whole row again; FINAL keeps the latest
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY version`;

/** Our stable database and `deployments`: safe to run any time, before any version exists. */
export const migrateStatements = (schema: Pick<Schema, 'database'>): Sql[] => [
    sql`CREATE DATABASE IF NOT EXISTS ${ident(schema.database)}`,
    deploymentsTableStatement(schema),
];

export const migrate = async (client: ClickhouseClient, schema: Pick<Schema, 'database'>): Promise<void> => {
    for (const statement of migrateStatements(schema)) await client.command(statement);
};

type DeploymentRow = {
    version: number;
    envio_database: string;
    state: DeploymentState;
    created: string;
    ready: string | null;
    activated: string | null;
    retired: string | null;
    tables_dropped: string | null;
    envio_dropped: string | null;
    updated: string;
};

export const listDeploymentsStatement = (schema: Pick<Schema, 'database'>): Sql => sql`
SELECT version, envio_database, toString(state) AS state, toString(created_at) AS created, toString(ready_at) AS ready,
    toString(activated_at) AS activated, toString(retired_at) AS retired, toString(tables_dropped_at) AS tables_dropped,
    toString(envio_dropped_at) AS envio_dropped, toString(updated_at) AS updated
FROM ${qualified(schema.database, deploymentsTable())} FINAL
ORDER BY version`;

export const listDeployments = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>
): Promise<Deployment[]> =>
    (await client.query<DeploymentRow>(listDeploymentsStatement(schema))).map((row) => ({
        version: row.version,
        envioDatabase: row.envio_database,
        state: row.state,
        createdAt: row.created,
        readyAt: row.ready,
        activatedAt: row.activated,
        retiredAt: row.retired,
        tablesDroppedAt: row.tables_dropped,
        envioDroppedAt: row.envio_dropped,
        updatedAt: row.updated,
    }));

export const getDeployment = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    version: number
): Promise<Deployment> => {
    const deployment = (await listDeployments(client, schema)).find((d) => d.version === versionNumber(version));
    if (deployment === undefined) throw new Error(`version ${version} is not deployed`);
    return deployment;
};

/** What a state change writes: the new state, and which step times to set to now. */
export type DeploymentChange = {
    state?: DeploymentState;
    now?: readonly ('ready_at' | 'activated_at' | 'retired_at' | 'tables_dropped_at' | 'envio_dropped_at')[];
};

/** Rewrites one deployment row with some columns changed; the rest is copied as it is. */
export const updateDeploymentStatement = (
    schema: Pick<Schema, 'database'>,
    version: number,
    { state, now = [] }: DeploymentChange
): Sql => {
    const table = qualified(schema.database, deploymentsTable());
    const values = R.map(DEPLOYMENT_COLUMNS, (column) => {
        if (column === 'state' && state !== undefined) return param('String', state);
        if (column === 'updated_at' || (now as readonly string[]).includes(column)) return sql`now64(6)`;
        return ident(column);
    });
    return sql`INSERT INTO ${table} (${join(R.map(DEPLOYMENT_COLUMNS, ident))})
SELECT ${join(values)} FROM ${table} FINAL WHERE version = ${param('UInt32', versionNumber(version))}`;
};

const updateDeployment = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    version: number,
    change: DeploymentChange
): Promise<void> => {
    await client.command(updateDeploymentStatement(schema, version, change));
};

export const registerDeploymentStatement = (
    schema: Pick<Schema, 'database'>,
    version: number,
    envioDatabase: string
): Sql =>
    sql`INSERT INTO ${qualified(schema.database, deploymentsTable())} (version, envio_database, state, created_at, updated_at)
SELECT ${param('UInt32', versionNumber(version))}, ${param('String', databaseName(envioDatabase))}, 'building', now64(6), now64(6)`;

/**
 * Registers version N as `building` and creates its tables. Rerunnable: the tables are created if missing, and a version
 * already registered with the same Envio database is left as it is. The Envio database need not exist yet (Envio creates
 * it when it starts), but it must be `<prefix><N>` ({@link envioDatabaseOf}): cleanup drops it one day, so a typo here
 * must not be able to name any other database.
 */
export const deploy = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database' | 'envioDatabasePrefix'>,
    version: number,
    envioDatabase: string
): Promise<void> => {
    const n = versionNumber(version);
    databaseName(envioDatabase);
    if (envioDatabase === schema.database) throw new Error('the Envio database must not be ours');
    if (envioDatabase !== envioDatabaseOf(schema, n)) {
        throw new Error(`version ${n} must use the Envio database ${envioDatabaseOf(schema, n)}, not ${envioDatabase}`);
    }
    const existing = (await listDeployments(client, schema)).find((d) => d.version === n);
    if (existing !== undefined && (existing.envioDatabase !== envioDatabase || existing.state === 'dropped')) {
        throw new Error(
            `version ${n} is already deployed (${existing.state}, ${existing.envioDatabase}): use a new number`
        );
    }
    await client.command(eventPriceTableStatement(schema, n));
    await client.command(priceWatermarkTableStatement(schema, n));
    if (existing === undefined) await client.command(registerDeploymentStatement(schema, n, envioDatabase));
};

/** How many of `columns` the table `database.table` has. */
export const columnCountStatement = (database: string, table: string, columns: readonly string[]): Sql =>
    sql`SELECT count() AS n FROM system.columns
WHERE database = ${param('String', database)} AND table = ${param('String', table)} AND name IN ${param('Array(String)', columns)}`;

const hasColumns = async (
    client: ClickhouseClient,
    database: string,
    table: string,
    columns: readonly string[]
): Promise<boolean> => {
    const [row] = await client.query<{ n: string }>(columnCountStatement(database, table, columns));
    return Number(row?.n) === columns.length;
};

/** Whether Envio's `TimelineEvent` of this database has the indexer price columns ({@link headColumns}). */
export const hasHeadColumns = (client: ClickhouseClient, envioDatabase: string): Promise<boolean> =>
    hasColumns(client, databaseName(envioDatabase), timelineEventHistoryTable(), headColumns());

/** Whether `event_price_<N>` stores `facts_complete` (versions deployed before it was added do not). */
const hasFactsColumn = (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    version: number
): Promise<boolean> => hasColumns(client, databaseName(schema.database), eventPriceTable(version), ['facts_complete']);

/** Which of `tables` exist in `database`. */
export const existingTablesStatement = (database: string, tables?: readonly string[]): Sql =>
    sql`SELECT name FROM system.tables WHERE database = ${param('String', database)}${tables === undefined ? sql`` : sql` AND name IN ${param('Array(String)', tables)}`}
ORDER BY name`;

const existingTables = async (
    client: ClickhouseClient,
    database: string,
    tables?: readonly string[]
): Promise<string[]> => {
    return (await client.query<{ name: string }>(existingTablesStatement(database, tables))).map(({ name }) => name);
};

export type PendingOptions = {
    /** Only events older than this count (the next advance is due for younger ones). */
    olderThanSeconds: number;
    /** Only the events of the last this many days (the worker's check); the whole history by default (the switch gate). */
    sinceDays?: number;
};

/**
 * The statement counting, in `range`, the events of a version the API would show `PENDING`: committed at `frontier`,
 * older than `olderThanSeconds`, matching `filter`, with neither a stored row (of the same range) nor an indexer price.
 */
export const pendingEventsStatement = (
    schema: Pick<Schema, 'database'>,
    deployment: Pick<Deployment, 'version' | 'envioDatabase'>,
    frontier: Readonly<Record<string, string>>,
    range: Range,
    { olderThanSeconds, filter }: { olderThanSeconds: number; filter?: EventFilter }
): Sql =>
    // the stored rows are left out before the deduplication (by id, so every history row of a stored event goes), the
    // indexer price after it (the latest row's)
    sql`
WITH
stored_keys AS
(
    SELECT account, event_id, timestamp FROM ${qualified(schema.database, eventPriceTable(deployment.version))}
    WHERE ${rangeWhere(ident('timestamp'), range)}
),
${timelineEventsCtes(deployment.envioDatabase, 'events', {
    where: sql`${rangeWhere(ident('block_timestamp'), range)} AND block_timestamp < now64(3) - toIntervalSecond(${param('UInt32', Math.floor(olderThanSeconds))})
        AND (account, id, block_timestamp) NOT IN stored_keys${filter === undefined ? sql`` : sql` AND (${filter.where})`}`,
    frontier: frontierParam(frontier),
    latest: sql`head_price IS NULL`,
})}
SELECT count() AS n FROM events`;

/**
 * The events of a version that the API would show `PENDING`: committed, older than `olderThanSeconds`, with neither a
 * stored row nor an indexer price. Over the whole history by default (the switch gate); `sinceDays` limits it to the
 * recent events (the worker's check).
 *
 * Never one statement over the whole history. Below the watermark every event committed at the frontier the watermark
 * recorded is stored (the advance stores every row it passes), so only two kinds of events need looking at:
 * - from `retryDays` before the watermark on: every event (late rows, ids reused after a rollback, the rows above the
 *   watermark waiting for their provisional row);
 * - before that: only the events committed after the recorded frontier (late rows).
 * Before the first advance there is no watermark and every event is looked at. Either way the time ranges are cut by
 * event counts like the reprice statements (ranges.ts), and each statement runs with the same per query limits: its
 * cost depends on its chunk, never on the length of history.
 */
export const pendingEvents = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    deployment: Pick<Deployment, 'version' | 'envioDatabase'>,
    { olderThanSeconds, sinceDays, settings }: PendingOptions & { settings: RepriceSettings }
): Promise<number> => {
    const frontier = await readFrontier(client, deployment.envioDatabase);
    const watermark = await readWatermark(client, schema, deployment.version);
    const sinceMs = sinceDays === undefined ? 0 : Date.now() - sinceDays * 86_400_000;
    const untilMs = Date.now() - olderThanSeconds * 1000;
    const recentMs = watermark === undefined ? 0 : msOf(watermark.watermark) - settings.retryDays * 86_400_000;
    const parts: { step: string; fromMs: number; toMs: number; filter: EventFilter }[] = [
        ...(watermark === undefined
            ? []
            : [
                  {
                      step: 'late',
                      fromMs: sinceMs,
                      toMs: Math.min(recentMs, untilMs),
                      filter: { where: sql`envio_checkpoint_id > ${frontierParam(watermark.checkpoints)}[chain_id]` },
                  },
              ]),
        { step: 'recent', fromMs: Math.max(sinceMs, recentMs), toMs: untilMs, filter: { where: sql`1` } },
    ];
    let pending = 0;
    for (const { step, fromMs, toMs, filter } of R.filter(parts, ({ fromMs, toMs }) => fromMs < toMs)) {
        const range = { from: timeOf(fromMs), to: timeOf(toMs) };
        for (const sub of await plannedRanges(
            client,
            deployment,
            frontier,
            range,
            filter,
            settings,
            `pending-${step}`
        )) {
            if (sub.events === 0) continue;
            const [row] = await client.query<{ n: string }>(
                pendingEventsStatement(schema, deployment, frontier, sub, { olderThanSeconds, filter }),
                {
                    settings: repriceQuerySettings(settings),
                    timeoutMs: repriceTimeoutMs(settings),
                    comment: `pending:v${deployment.version}:${step}:${sub.events}`,
                }
            );
            pending += Number(row?.n ?? 0);
        }
    }
    return pending;
};

/** What the switch gate needs: how old an unpriced event may be, and how to size and limit its statements. */
export type GateSettings = RepriceSettings;

/**
 * Why the API could not serve a version as it is, or undefined when it can: Envio's `TimelineEvent` has no indexer price
 * columns (a version indexed before them: the view reads them), or some events older than the grace have no price at
 * all (an advance has not given them their provisional row yet).
 */
const unservable = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    deployment: Pick<Deployment, 'version' | 'envioDatabase'>,
    settings: GateSettings
): Promise<string | undefined> => {
    const { pendingGraceSeconds } = settings;
    if (!(await hasHeadColumns(client, deployment.envioDatabase))) {
        return `version ${deployment.version}: ${deployment.envioDatabase}.${timelineEventHistoryTable()} has no ${headColumns().join(', ')} columns (indexed before the indexer priced events), the API view cannot read it`;
    }
    const pending = await pendingEvents(client, schema, deployment, {
        olderThanSeconds: pendingGraceSeconds,
        settings,
    });
    if (pending > 0) {
        return `version ${deployment.version} has ${pending} events older than ${pendingGraceSeconds / 60} minutes with no price (PENDING): run advance first`;
    }
    return undefined;
};

/**
 * Marks a building version ready to be switched to. Called by an operator or the worker once its checks pass (see
 * {@link readiness}): Envio at the chain head, the watermark current, event counts close to the active version's.
 * Refused, unless forced, while the API could not serve it: no indexer price columns, or `PENDING` events.
 */
export const markReady = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    version: number,
    { force = false, ...gate }: GateSettings & { force?: boolean }
): Promise<void> => {
    const deployment = await getDeployment(client, schema, version);
    if (deployment.state !== 'building') throw new Error(`version ${version} is ${deployment.state}, not building`);
    const refusal = force ? undefined : await unservable(client, schema, deployment, gate);
    if (refusal !== undefined) throw new Error(`${refusal} (use --force to mark it ready anyway)`);
    await updateDeployment(client, schema, version, { state: 'ready', now: ['ready_at'] });
};

/**
 * Points the API at version N: records it `active` and the previous active version `retired`, then recreates the API
 * views naming its tables and its Envio database (each swapped in atomically, the timeline view first). Undoing a
 * switch is a switch back (`force`, since the previous version is then `retired`). Refused for a version that is not
 * `ready`, whose `TimelineEvent` has no indexer price columns, or that has `PENDING` events older than the grace, unless
 * forced; always for a dropped one or one whose tables are missing. Forcing a version without the indexer price columns
 * builds a timeline view that fails on every read (ClickHouse does not check a parameterized view's columns when it
 * creates it): switch back to undo it.
 *
 * The state is written before the views so that a switch back to a version retired long ago does not race cleanup:
 * once the target is `active`, cleanup (which reads the state again right before dropping anything, and also skips a
 * version any of our views still names) leaves it alone. If the views fail halfway, `deployments` already says where
 * the switch was going: running the same switch again converges.
 */
export const switchVersion = async (
    client: ClickhouseClient,
    schema: Schema,
    version: number,
    { force = false, ...gate }: GateSettings & { force?: boolean }
): Promise<void> => {
    const deployments = await listDeployments(client, schema);
    const target = deployments.find((d) => d.version === versionNumber(version));
    if (target === undefined) throw new Error(`version ${version} is not deployed`);
    if (target.state === 'dropped' || target.tablesDroppedAt !== null) throw new Error(`version ${version} is dropped`);
    if (target.state !== 'ready' && target.state !== 'active' && !force) {
        throw new Error(`version ${version} is ${target.state}, not ready (use --force to switch anyway)`);
    }
    const refusal = force ? undefined : await unservable(client, schema, target, gate);
    if (refusal !== undefined) throw new Error(`${refusal} (use --force to switch anyway)`);
    const active: ActiveVersion = { version: target.version, envioDatabase: target.envioDatabase };
    if (target.state !== 'active') {
        await updateDeployment(client, schema, target.version, { state: 'active', now: ['activated_at'] });
    }
    for (const previous of deployments.filter((d) => d.state === 'active' && d.version !== target.version)) {
        await updateDeployment(client, schema, previous.version, { state: 'retired', now: ['retired_at'] });
    }
    const existing = new Set(await existingTables(client, schema.database));
    for (const view of apiViews(schema, active)) {
        if (!existing.has(view.name)) {
            // the first switch: nothing to swap with. Created under its own name, not created aside and renamed: the
            // definer's dependency record keeps the name a view is created under, and a renamed one would keep the
            // definer user from ever being dropped
            await client.command(view.create(view.name));
            continue;
        }
        // created aside then swapped in with EXCHANGE, which is atomic. Not CREATE OR REPLACE: with a definer it leaves
        // dependency records behind (its temporary views), and the definer user can then never be dropped.
        const next = `${view.name}_next`;
        await client.command(sql`DROP VIEW IF EXISTS ${qualified(schema.database, next)} SYNC`);
        await client.command(view.create(next));
        await client.command(
            sql`EXCHANGE TABLES ${qualified(schema.database, view.name)} AND ${qualified(schema.database, next)}`
        );
        await client.command(sql`DROP VIEW ${qualified(schema.database, next)} SYNC`);
    }
};

/** A version's watermark and the Envio frontier its stored rows were read at; undefined before the first advance. */
export type Watermark = { watermark: string; checkpoints: Record<string, string> };

export const readWatermarkStatement = (schema: Pick<Schema, 'database'>, version: number): Sql => sql`
SELECT toString(watermark) AS at, arrayMap(k -> toString(k), mapKeys(checkpoints)) AS chains,
    arrayMap(v -> toString(v), mapValues(checkpoints)) AS committed
FROM ${qualified(schema.database, priceWatermarkTable(version))} FINAL`;

export const readWatermark = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    version: number
): Promise<Watermark | undefined> => {
    // aliases named apart from the columns: ClickHouse would substitute an alias for a column of the same name
    const [row] = await client.query<{ at: string; chains: string[]; committed: string[] }>(
        readWatermarkStatement(schema, version)
    );
    if (row === undefined) return undefined;
    return { watermark: row.at, checkpoints: zip(row.chains, row.committed) };
};

const zip = (keys: readonly string[], values: readonly string[]): Record<string, string> =>
    R.fromEntries(R.map(keys, (key, index) => [key, values[index] ?? ''] as const));

/**
 * The statement writing a watermark row: `moved_at` is now, or `moved_at` (a `DateTime64(6)` string read back from
 * ClickHouse) when given.
 */
export const writeWatermarkStatement = (
    schema: Pick<Schema, 'database'>,
    version: number,
    { watermark, checkpoints }: Watermark,
    movedAt?: string
): Sql =>
    sql`INSERT INTO ${qualified(schema.database, priceWatermarkTable(version))} (watermark, checkpoints, moved_at)
SELECT ${param("DateTime64(3, 'UTC')", watermark)}, ${frontierParam(checkpoints)}, ${movedAt === undefined ? sql`now64(6)` : param("DateTime64(6, 'UTC')", movedAt)}`;

/** `moved_at` of a version's latest watermark row and the next one to write (now, and always after the latest). */
export const watermarkMovesStatement = (schema: Pick<Schema, 'database'>, version: number): Sql => sql`
SELECT toString(max(moved_at)) AS moved, count() AS n,
    toString(greatest(now64(6, 'UTC'), max(moved_at) + toIntervalMicrosecond(1))) AS next
FROM ${qualified(schema.database, priceWatermarkTable(version))}`;

/**
 * The `moved_at` of a version's latest watermark row, `''` before the first: what {@link writeWatermarkIfUnchanged}
 * compares. Every write (an advance, a rewind) inserts a row with a later `moved_at`.
 */
export const watermarkMovedAt = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    version: number
): Promise<string> => {
    const [row] = await client.query<{ moved: string; n: string }>(watermarkMovesStatement(schema, version));
    return Number(row?.n) > 0 && row !== undefined ? row.moved : '';
};

/**
 * Compare-and-set of the watermark: writes it only if the latest row is still the one whose `moved_at` the caller saw
 * (`expectedMovedAt`, from {@link watermarkMovedAt} or this function's previous result), and returns the new row's
 * `moved_at`; returns undefined, writing nothing, when someone else wrote meanwhile (a rewind during an advance, which
 * must not be undone by the advance's next chunk).
 *
 * The new row's `moved_at` is the server time of the check (and always after the row it replaces). A write that lands
 * between the check and this insert gets a later server time, so it wins under `FINAL` and the caller's next check
 * sees it: the rewind is never lost, at worst the advance writes once more under it, which changes nothing that is read.
 */
export const writeWatermarkIfUnchanged = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    version: number,
    expectedMovedAt: string,
    watermark: Watermark
): Promise<string | undefined> => {
    const [row] = await client.query<{ moved: string; n: string; next: string }>(
        watermarkMovesStatement(schema, version)
    );
    if (row === undefined) throw new Error('watermark check: no row');
    if ((Number(row.n) > 0 ? row.moved : '') !== expectedMovedAt) return undefined;
    await client.command(writeWatermarkStatement(schema, version, watermark, row.next));
    return row.next;
};

const sameFrontier = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean =>
    R.isDeepEqual(a, b);

export const readFrontierStatement = (envioDatabase: string): Sql =>
    sql`SELECT toString(chain_id) AS chain, toString(checkpoint_id) AS checkpoint FROM ${qualified(envioDatabase, envioChainsTable())} FINAL`;

/** Envio's committed checkpoint per chain, now. */
export const readFrontier = async (
    client: ClickhouseClient,
    envioDatabase: string
): Promise<Record<string, string>> => {
    return R.pipe(
        await client.query<{ chain: string; checkpoint: string }>(readFrontierStatement(envioDatabase)),
        R.map(({ chain, checkpoint }) => [chain, checkpoint] as const),
        R.fromEntries()
    );
};

/** What {@link repriceStatement} compares to tell whether a row's result changed: its price columns, as one string. */
const RESULT_KEY = sql`toString(tuple(toString(product_address), toString(product_kind), toString(contract_kind), toUInt8(decimals),
    toFloat64(share_to_usd), toString(price_flag), toString(price_source), toString(price_resolution),
    CAST(price_before_at AS Nullable(DateTime('UTC'))), CAST(price_after_at AS Nullable(DateTime('UTC'))),
    toFloat64(usd_delta), toFloat64(usd_after), toUInt8(facts_complete)))`;

/**
 * Which events a reprice statement prices: `where` over the history table's columns (before the deduplication), with
 * its parameters, and CTEs it refers to. The statement adds the time range and the frontier.
 */
export type EventFilter = {
    where: Sql;
    /** CTE definitions `where` refers to (`name AS (...)`, comma separated). */
    ctes?: Sql;
    /** A filter applied after the deduplication, on the events' latest row (head_price IS NULL). */
    latest?: Sql;
    /**
     * Store only the rows whose result differs from their stored row, or that have none: the stored rows of the same
     * time range are compared with.
     */
    changedOnly?: boolean;
};

const rangeWhere = (column: Identifier, range: Range): Sql =>
    sql`${column} >= ${param("DateTime64(3, 'UTC')", range.from)}${range.to === undefined ? sql`` : sql` AND ${column} < ${param("DateTime64(3, 'UTC')", range.to)}`}`;

/**
 * The statement that prices the events of `filter` in `range` (block time), read at `frontier`, and stores them in
 * `event_price_<N>` with a new `version`, whatever their flag and whether their product facts are complete
 * (`facts_complete` is stored with them): nothing is priced when the API reads, so a row left out would stay `PENDING`
 * or keep its indexer price. The pricing is {@link pricedEventsCtes}.
 */
export const repriceStatement = (
    schema: Pick<Schema, 'database' | 'prices'>,
    deployment: Pick<Deployment, 'version' | 'envioDatabase'>,
    frontier: Readonly<Record<string, string>>,
    range: Range,
    { where, ctes, latest, changedOnly = false }: EventFilter
): Sql => {
    const table = qualified(schema.database, eventPriceTable(deployment.version));
    const columns = join(
        R.map(['account', 'chain_id', 'event_id', 'timestamp', ...priceColumns(), 'facts_complete'], ident)
    );
    return sql`
INSERT INTO ${table} (${columns}, version)
WITH
${ctes === undefined ? sql`` : sql`${ctes},`}
${timelineEventsCtes(deployment.envioDatabase, 'events', {
    where: sql`${rangeWhere(ident('block_timestamp'), range)} AND (${where})`,
    frontier: frontierParam(frontier),
    ...(latest === undefined ? {} : { latest }),
})},
${pricedEventsCtes(schema.prices, deployment.envioDatabase, 'events')}${
        changedOnly
            ? sql`,
stored_results AS
(
    SELECT account, event_id, timestamp, ${RESULT_KEY} AS result FROM ${table} FINAL WHERE ${rangeWhere(ident('timestamp'), range)}
)`
            : sql``
    }
SELECT ${columns}, toUInt64(toUnixTimestamp64Micro(now64(6))) AS version
FROM px_priced${changedOnly ? sql`\nWHERE (account, event_id, timestamp, ${RESULT_KEY}) NOT IN stored_results` : sql``}`;
};

/** The statement counting the history rows of `filter` per hour of `range` (at `frontier`), to plan the reprice statements. */
export const countEventsStatement = (
    deployment: Pick<Deployment, 'envioDatabase'>,
    frontier: Readonly<Record<string, string>>,
    range: Range,
    { where, ctes }: EventFilter
): Sql => sql`
WITH
${ctes === undefined ? sql`` : sql`${ctes},`}
hourly AS
(
    SELECT toStartOfHour(block_timestamp) AS hour, count() AS n
    FROM ${qualified(deployment.envioDatabase, timelineEventHistoryTable())}
    WHERE ${rangeWhere(ident('block_timestamp'), range)} AND (${where}) AND envio_checkpoint_id <= ${frontierParam(frontier)}[chain_id]
    GROUP BY hour
)
SELECT toString(hour) AS hour, n FROM hourly ORDER BY hour`;

/**
 * Where the watermark may move to now: `min(now - min age, freshest price of each required source - max price gap)`.
 * If a source stops, the watermark stops too, and the rows past it keep their indexer price or provisional row until its
 * prices arrive: nothing is stored as final with a stale price because of an outage. A source with no price in the last
 * 30 days counts as the epoch (the watermark does not move).
 */
export const watermarkTargetStatement = (
    schema: Pick<Schema, 'prices' | 'watermarkPriceSources'>,
    { watermarkMinAgeSeconds }: Pick<RepriceSettings, 'watermarkMinAgeSeconds'>
): Sql => sql`
WITH
freshest AS
(
    SELECT price_source, max(date_time) AS at
    FROM ${qualifiedName(schema.prices.price5m)}
    WHERE price_source IN ${param('Array(String)', schema.watermarkPriceSources)}
        AND date_time >= now() - toIntervalDay(${param('UInt32', SOURCE_LOOKBACK_DAYS)})
    GROUP BY price_source
)
SELECT toString(least(
    now64(3, 'UTC') - toIntervalSecond(${param('UInt32', watermarkMinAgeSeconds)}),
    if(count() = ${param('UInt32', new Set(schema.watermarkPriceSources).size)}, toDateTime64(min(at), 3, 'UTC'), toDateTime64(0, 3, 'UTC'))
        - toIntervalSecond(${param('UInt32', maxPriceGapSeconds())})
)) AS target
FROM freshest`;

export const watermarkTarget = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'prices' | 'watermarkPriceSources'>,
    settings: Pick<RepriceSettings, 'watermarkMinAgeSeconds'>
): Promise<string> => {
    const [row] = await client.query<{ target: string }>(watermarkTargetStatement(schema, settings));
    if (row === undefined) throw new Error('watermark target: no row');
    return row.target;
};

export type AdvanceResult = {
    version: number;
    /**
     * Not advanced: the Envio database does not exist yet (`no-envio-database`), or it has no committed event yet
     * (`no-events`; the first advance starts at the oldest event, so it waits for one).
     */
    waiting?: 'no-envio-database' | 'no-events';
    /**
     * Never advanced by this code: a version deployed before `event_price_<N>` stored `facts_complete`, or whose Envio
     * `TimelineEvent` has no indexer price columns. The API view cannot serve it either; cleanup drops it once retired.
     */
    unsupported?: string;
    /**
     * Stopped: the watermark was written by someone else since this advance started (a rewind). Nothing of theirs was
     * overwritten; `to` is where this advance had got to, the next run starts from the new watermark.
     */
    superseded?: boolean;
    from?: string;
    to?: string;
    /** Reprice statements run (each one INSERT): late rows, the retry window, the watermark step, the provisional rows. */
    statements: number;
};

/** The first event of a version (the start of its first advance) and how many committed rows it has. */
export const firstEventStatement = (envioDatabase: string, frontier: Readonly<Record<string, string>>): Sql =>
    sql`SELECT toString(toStartOfDay(min(block_timestamp))) AS first, count() AS n
FROM ${qualified(envioDatabase, timelineEventHistoryTable())}
WHERE envio_checkpoint_id <= ${frontierParam(frontier)}[chain_id] AND envio_change = 'SET'`;

/** Whether a version's Envio database has the tables we read. */
const envioTablesExist = async (client: ClickhouseClient, envioDatabase: string): Promise<boolean> =>
    (await existingTables(client, databaseName(envioDatabase), [timelineEventHistoryTable(), envioChainsTable()]))
        .length === 2;

/**
 * `range` cut into the ranges one statement covers: the history rows of `filter` counted per hour (at `frontier`), then
 * at most `stepDays` of events and about `maxEventsPerStatement` events per range (see ranges.ts).
 */
const plannedRanges = async (
    client: ClickhouseClient,
    deployment: Pick<Deployment, 'version' | 'envioDatabase'>,
    frontier: Readonly<Record<string, string>>,
    range: Range,
    filter: EventFilter,
    settings: RepriceSettings,
    step: string
): Promise<PlannedRange[]> => {
    const buckets = await client.query<{ hour: string; n: string }>(
        countEventsStatement(deployment, frontier, range, filter),
        {
            settings: repriceQuerySettings(settings),
            timeoutMs: repriceTimeoutMs(settings),
            comment: `count:v${deployment.version}:${step}`,
        }
    );
    return planRanges(
        range,
        R.map(buckets, ({ hour, n }) => ({ startMs: msOf(hour), events: Number(n) })),
        {
            maxEvents: settings.maxEventsPerStatement,
            maxSpanMs: settings.stepDays * 86_400_000,
            bucketMs: COUNT_BUCKET_MS,
        }
    );
};

/**
 * Prices the events of `filter` in `range`, one statement per planned sub-range ({@link plannedRanges}), calling
 * `after` once each sub-range is stored. Sub-ranges with no event run no statement. Returns how many statements ran,
 * and whether `after` asked to stop.
 */
const repriceRanges = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database' | 'prices'>,
    deployment: Pick<Deployment, 'version' | 'envioDatabase'>,
    frontier: Readonly<Record<string, string>>,
    range: Range,
    filter: EventFilter,
    settings: RepriceSettings,
    { step, after }: { step: string; after?: (range: Range) => Promise<boolean> }
): Promise<{ statements: number; stopped: boolean }> => {
    const planned = await plannedRanges(client, deployment, frontier, range, filter, settings, step);
    let statements = 0;
    for (const sub of planned) {
        if (sub.events > 0) {
            await client.command(repriceStatement(schema, deployment, frontier, sub, filter), {
                settings: repriceQuerySettings(settings),
                timeoutMs: repriceTimeoutMs(settings),
                comment: `reprice:v${deployment.version}:${step}:${sub.events}`,
            });
            statements += 1;
        }
        if (after !== undefined && !(await after(sub))) return { statements, stopped: true };
    }
    return { statements, stopped: false };
};

/**
 * Moves one version's watermark to {@link watermarkTarget}, storing the prices of the events it passes:
 * 1. events committed since the last advance with a timestamp below the old watermark (a chain Envio was still catching
 *    up on, a zap update), found by checkpoint. Skipped when Envio's frontier has not moved since;
 * 2. events of the last `retryDays` below the old watermark with no stored row or a row that is not final, written
 *    again only when their result changed (see `finalPriceFlags`);
 * 3. events with `old watermark <= timestamp < target`, the watermark written after each statement's range;
 * 4. provisional rows: events at or above the new watermark that the indexer did not price, with the prices known so far,
 *    written only when their result changed since the last run (so a late price snaps back within one run, and an
 *    advance in normal operation writes next to nothing). Step 3 of a later run replaces them with their final row.
 *
 * Every step counts its events per hour first and splits its time range so that no statement prices more than
 * `maxEventsPerStatement` events or spans more than `stepDays` days of events; each statement runs with the per query
 * memory and time limits of `settings`. A statement's cost so depends on its chunk, never on the length of history.
 *
 * Steps 1 to 3 store every row, whatever its flag and whether its product facts are complete: nothing is priced when
 * the API reads.
 *
 * All statements read Envio at the frontier captured at the start, recorded with the watermark, so a row committed
 * meanwhile is picked up by step 1 of the next run. The first run starts at the oldest event. Each watermark write is
 * a compare-and-set against the row seen at the start ({@link writeWatermarkIfUnchanged}): a rewind meanwhile stops the
 * advance (`superseded`) instead of being overwritten by its next chunk.
 */
export const advanceVersion = async (
    client: ClickhouseClient,
    schema: Schema,
    deployment: Pick<Deployment, 'version' | 'envioDatabase'>,
    settings: RepriceSettings
): Promise<AdvanceResult> => {
    const { version, envioDatabase } = deployment;
    if (!(await envioTablesExist(client, envioDatabase)))
        return { version, waiting: 'no-envio-database', statements: 0 };
    if (!(await hasFactsColumn(client, schema, version))) {
        return {
            version,
            unsupported: `${eventPriceTable(version)} has no facts_complete column (deployed before it)`,
            statements: 0,
        };
    }
    if (!(await hasHeadColumns(client, envioDatabase))) {
        return {
            version,
            unsupported: `${envioDatabase}.${timelineEventHistoryTable()} has no indexer price columns`,
            statements: 0,
        };
    }

    // read before the watermark itself: a rewind landing in between makes the first write fail, never get lost
    let movedAt = await watermarkMovedAt(client, schema, version);
    const checkpoints = await readFrontier(client, envioDatabase);
    const current = await readWatermark(client, schema, version);
    const target = await watermarkTarget(client, schema, settings);
    let statements = 0;
    const run = async (
        step: string,
        range: Range,
        filter: EventFilter,
        after?: (range: Range) => Promise<boolean>
    ): Promise<boolean> => {
        const done = await repriceRanges(client, schema, deployment, checkpoints, range, filter, settings, {
            step,
            ...(after === undefined ? {} : { after }),
        });
        statements += done.statements;
        return !done.stopped;
    };
    const move = async (watermark: string): Promise<boolean> => {
        const next = await writeWatermarkIfUnchanged(client, schema, version, movedAt, { watermark, checkpoints });
        if (next === undefined) return false;
        movedAt = next;
        return true;
    };

    if (current !== undefined) {
        if (!sameFrontier(current.checkpoints, checkpoints)) {
            await run(
                'late',
                { from: timeOf(0), to: current.watermark },
                { where: sql`envio_checkpoint_id > ${frontierParam(current.checkpoints)}[chain_id]` }
            );
        }
        const retry = {
            from: timeOf(msOf(current.watermark) - settings.retryDays * 86_400_000),
            to: current.watermark,
        };
        await run('retry', retry, {
            ctes: sql`final_rows AS
(
    SELECT account, event_id, timestamp FROM ${qualified(schema.database, eventPriceTable(version))} FINAL
    WHERE ${rangeWhere(ident('timestamp'), retry)}
        AND price_flag IN ${param('Array(String)', finalPriceFlags())} AND facts_complete = 1
)`,
            where: sql`(account, id, block_timestamp) NOT IN final_rows`,
            changedOnly: true,
        });
    }
    let start = current?.watermark;
    if (start === undefined) {
        const [row] = await client.query<{ first: string; n: string }>(firstEventStatement(envioDatabase, checkpoints));
        if (row === undefined || Number(row.n) === 0) return { version, waiting: 'no-events', statements };
        start = row.first;
    }
    const from = start;
    let reached = start;
    if (msOf(start) < msOf(target)) {
        const completed = await run('watermark', { from: start, to: target }, { where: sql`1` }, async (range) => {
            const to = range.to ?? target;
            if (!(await move(to))) return false;
            reached = to;
            return true;
        });
        if (!completed) return { version, superseded: true, from, to: reached, statements };
    } else if (!(await move(start))) {
        // nothing to move (the target did not pass the watermark): still record the frontier step 1 covered
        return { version, superseded: true, from, to: start, statements };
    }
    await run('provisional', { from: reached }, { where: sql`1`, latest: sql`head_price IS NULL`, changedOnly: true });
    return { version, from, to: reached, statements };
};

/** {@link advanceVersion} for every version not dropped: the worker's loop. */
export const advance = async (
    client: ClickhouseClient,
    schema: Schema,
    settings: RepriceSettings
): Promise<AdvanceResult[]> => {
    const results: AdvanceResult[] = [];
    for (const deployment of await listDeployments(client, schema)) {
        if (deployment.state === 'dropped' || deployment.tablesDroppedAt !== null) continue;
        results.push(await advanceVersion(client, schema, deployment, settings));
    }
    return results;
};

/**
 * Moves a version's watermark back to `time`. The next advance reprices the rows above it that the indexer did not price
 * as provisional rows (written where the result changed), then stores them as final again as the watermark catches up.
 * For days or weeks of rows (an upstream gap filled later, a facts fix).
 */
export const rewind = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    version: number,
    time: string
): Promise<void> => {
    const watermark = utcTime(time);
    const current = await readWatermark(client, schema, versionNumber(version));
    if (current === undefined) throw new Error(`version ${version} has no watermark yet`);
    if (msOf(watermark) > msOf(current.watermark)) {
        throw new Error(`rewind moves the watermark back: ${time} is after ${current.watermark}`);
    }
    await client.command(writeWatermarkStatement(schema, version, { watermark, checkpoints: current.checkpoints }));
};

/**
 * Reprices the events with `from <= timestamp < to` in place, without moving the watermark: new rows with a higher
 * version, `FINAL` hides the old ones. Split into bounded statements like an advance. Returns the statements run.
 */
export const reprice = async (
    client: ClickhouseClient,
    schema: Schema,
    version: number,
    from: string,
    to: string,
    settings: RepriceSettings
): Promise<number> => {
    const range = { from: utcTime(from), to: utcTime(to) };
    if (msOf(range.from) >= msOf(range.to)) throw new Error(`reprice needs from < to, got ${from} and ${to}`);
    const deployment = await getDeployment(client, schema, version);
    if (deployment.state === 'dropped') throw new Error(`version ${version} is dropped`);
    const frontier = await readFrontier(client, deployment.envioDatabase);
    return (
        await repriceRanges(client, schema, deployment, frontier, range, { where: sql`1` }, settings, {
            step: 'reprice',
        })
    ).statements;
};

export type Readiness = {
    version: number;
    watermark: string | undefined;
    watermarkAgeSeconds: number | undefined;
    /** Committed events per chain (history rows at or below the frontier, not deduplicated: a close estimate). */
    events: Record<string, number>;
    /** The same for the active version, to compare with; empty when there is none. */
    activeEvents: Record<string, number>;
    /** Whether Envio's `TimelineEvent` has the indexer price columns: the API view cannot serve a version without them. */
    headColumns: boolean;
    /**
     * Events older than the grace with neither a stored row nor an indexer price ({@link pendingEvents}): `ready` and
     * `switch` refuse while it is not 0. Undefined without the indexer price columns.
     */
    pendingEvents: number | undefined;
};

export const eventsPerChainStatement = (envioDatabase: string): Sql => sql`
WITH ${committedFrontier(envioDatabase)} AS envio_frontier
SELECT toString(chain_id) AS chain, count() AS n
FROM ${qualified(envioDatabase, timelineEventHistoryTable())}
WHERE envio_checkpoint_id <= envio_frontier[chain_id] AND envio_change = 'SET'
GROUP BY chain_id`;

const eventsPerChain = async (client: ClickhouseClient, envioDatabase: string): Promise<Record<string, number>> =>
    R.pipe(
        await client.query<{ chain: string; n: string }>(eventsPerChainStatement(envioDatabase)),
        R.map(({ chain, n }) => [chain, Number(n)] as const),
        R.fromEntries()
    );

/**
 * What the worker (or an operator) checks before {@link markReady}: the watermark is current, the event counts per
 * chain are close to the active version's, and no event is left without a price (`pendingEvents` is 0).
 *
 * TODO: Envio at the chain head. `envio_chains` holds the committed checkpoint, not the block it reached nor the chain
 * head; the worker has to compare Envio's progress (its Postgres `envio_chains` or its metrics) with the RPC block heads.
 * Until then `ready` is set explicitly and `switch` requires it.
 */
export const readiness = async (
    client: ClickhouseClient,
    schema: Schema,
    version: number,
    gate: GateSettings
): Promise<Readiness> => {
    const deployments = await listDeployments(client, schema);
    const deployment = deployments.find((d) => d.version === versionNumber(version));
    if (deployment === undefined) throw new Error(`version ${version} is not deployed`);
    const active = deployments.find((d) => d.state === 'active');
    const watermark = await readWatermark(client, schema, version);
    const head = await hasHeadColumns(client, deployment.envioDatabase);
    return {
        version,
        watermark: watermark?.watermark,
        watermarkAgeSeconds:
            watermark === undefined ? undefined : Math.round((Date.now() - msOf(watermark.watermark)) / 1000),
        events: await eventsPerChain(client, deployment.envioDatabase),
        activeEvents:
            active === undefined || active.version === deployment.version
                ? {}
                : await eventsPerChain(client, active.envioDatabase),
        headColumns: head,
        pendingEvents: head
            ? await pendingEvents(client, schema, deployment, {
                  olderThanSeconds: gate.pendingGraceSeconds,
                  settings: gate,
              })
            : undefined,
    };
};

export type CleanupReport = {
    /** What this run dropped, in order, e.g. `version 3: tables`, `version 3: envio_dev_3`. */
    dropped: string[];
    /**
     * Expired versions kept because one of our views still names their tables or Envio database (an API view during a
     * switch back, a `_next` view a failed switch left behind), e.g. `version 3: user_timeline_api_next`.
     */
    inUse: string[];
    /**
     * Envio databases cleanup refused to drop, with why: not `<prefix><N>` of their version, or a database that is never
     * dropped (ClickHouse's own, ours, the price tables'). The version's tables are dropped, its state stays `retired`.
     */
    refused: string[];
    /** Envio databases (`<prefix><N>`) no live version uses: never dropped automatically. */
    unknownDatabases: string[];
    /** `event_price_<N>` / `price_watermark_<N>` tables of no live version: never dropped automatically. */
    unknownTables: string[];
};

/** A pattern matching `name` as a whole word; escaped, since a `deployments` row may have been written by hand. */
const wholeName = (name: string): RegExp => new RegExp(`\\b${name.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')}\\b`);

const SYSTEM_DATABASES = ['system', 'default', 'information_schema', 'INFORMATION_SCHEMA'];

/** Why `deployment`'s Envio database must not be dropped, or undefined when it may be. */
const undroppable = (
    schema: Pick<Schema, 'database' | 'prices' | 'envioDatabasePrefix'>,
    deployment: Pick<Deployment, 'version' | 'envioDatabase'>
): string | undefined => {
    const name = deployment.envioDatabase;
    const protectedNames = [...SYSTEM_DATABASES, schema.database, ...R.map(R.values(schema.prices), databaseOf)];
    if (protectedNames.includes(name)) return 'a database cleanup never drops';
    if (envioDatabaseVersion(schema, name) !== deployment.version) {
        return `not ${envioDatabaseOf(schema, deployment.version)}, the Envio database of version ${deployment.version}`;
    }
    return undefined;
};

/** Our views and their definitions: cleanup keeps a version any of them names. */
export const viewsStatement = (database: string): Sql =>
    sql`SELECT name, create_table_query AS query FROM system.tables
WHERE database = ${param('String', database)} AND engine = 'View' ORDER BY name`;

export const databasesStatement = (): Sql => sql`SELECT name FROM system.databases ORDER BY name`;

/**
 * Drops the versions retired for longer than the grace period, one recorded step at a time: the version's tables, then
 * its Envio database (kept when another live version uses the same one). Every step is recorded in `deployments` once
 * done and skipped by a rerun, and each `DROP ... IF EXISTS` is harmless twice, so an interrupted cleanup just runs
 * again. Databases and tables that look like ours but belong to no live version are reported, never dropped.
 *
 * Before touching a version it reads its state again (a switch back marks it `active` before rebuilding the views) and
 * skips it if any view of ours names its tables or Envio database (`system.tables.create_table_query`): the API views,
 * or a `_next` view of an interrupted switch. Right before a `DROP DATABASE` it checks the name once more: it must be
 * `<prefix><N>` for the version's own N, and never ClickHouse's own databases, ours or the price tables'.
 *
 * Envio's Postgres schema of a dropped version is not touched here.
 */
export const cleanup = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database' | 'prices' | 'envioDatabasePrefix'>,
    { graceHours }: { graceHours: number }
): Promise<CleanupReport> => {
    const dropped: string[] = [];
    const inUse: string[] = [];
    const refused: string[] = [];
    const deployments = await listDeployments(client, schema);
    const expired = deployments.filter(
        (d) => d.state === 'retired' && d.retiredAt !== null && Date.now() - msOf(d.retiredAt) >= graceHours * 3_600_000
    );
    for (const { version } of expired) {
        const deployment = await getDeployment(client, schema, version);
        if (deployment.state !== 'retired') continue;
        const definitions = await client.query<{ name: string; query: string }>(
            viewsStatement(databaseName(schema.database))
        );
        // whole names only (`event_price_1` is not `event_price_12`)
        const names = [...versionTables(version), deployment.envioDatabase].map(wholeName);
        const users = R.pipe(
            definitions,
            R.filter(({ query }) => names.some((name) => name.test(query))),
            R.map(({ name }) => name)
        );
        if (users.length > 0) {
            inUse.push(`version ${version}: ${users.join(', ')}`);
            continue;
        }
        if (deployment.tablesDroppedAt === null) {
            for (const table of versionTables(version)) {
                await client.command(sql`DROP TABLE IF EXISTS ${qualified(schema.database, table)} SYNC`);
            }
            await updateDeployment(client, schema, version, { now: ['tables_dropped_at'] });
            dropped.push(`version ${version}: tables`);
        }
        // another version still in use (or still within its grace period) on the same Envio database keeps it
        const shared = deployments.some(
            (d) =>
                d.envioDatabase === deployment.envioDatabase &&
                d.state !== 'dropped' &&
                !expired.some((e) => e.version === d.version)
        );
        if (shared) {
            await updateDeployment(client, schema, version, { state: 'dropped' });
            continue;
        }
        const refusal = undroppable(schema, deployment);
        if (refusal !== undefined) {
            refused.push(`version ${version}: ${deployment.envioDatabase}: ${refusal}`);
            continue;
        }
        await client.command(sql`DROP DATABASE IF EXISTS ${ident(deployment.envioDatabase)} SYNC`);
        await updateDeployment(client, schema, version, { state: 'dropped', now: ['envio_dropped_at'] });
        dropped.push(`version ${version}: ${deployment.envioDatabase}`);
    }

    const live = (await listDeployments(client, schema)).filter((d) => d.state !== 'dropped');
    const liveDatabases = new Set(live.map((d) => d.envioDatabase));
    const liveVersions = new Set(live.map((d) => d.version));
    const databases = await client.query<{ name: string }>(databasesStatement());
    const unknownDatabases = R.pipe(
        databases,
        R.map(({ name }) => name),
        R.filter((name) => envioDatabaseVersion(schema, name) !== undefined && !liveDatabases.has(name))
    );
    const unknownTables = (await existingTables(client, databaseName(schema.database))).filter((name) => {
        const version = versionOfTable(name);
        return version !== undefined && !liveVersions.has(version);
    });
    return { dropped, inUse, refused, unknownDatabases, unknownTables };
};
