import type { ClickhouseClient } from './client.ts';
import {
    type Deployment,
    type DeploymentState,
    type RepriceSettings,
    hasHeadColumns,
    listDeployments,
    pendingEvents,
    readWatermark,
} from './deployments.ts';
import { committedFrontier, timelineEventsCtes } from './events.ts';
import { type Schema, type Sql, msOf, sql } from './sql.ts';
import { apiStatusSelect } from './timeline.ts';

/** How the active version's recent events are priced: what tells an indexer price cache that stopped. */
export type HeadPriceStatus = {
    /** Events of the last hour, and how many of them the indexer did not price. */
    lastHourEvents: number;
    lastHourUnpriced: number;
    /** `lastHourUnpriced / lastHourEvents`, null without events. */
    lastHourUnpricedShare: number | null;
    /** Events older than the alert age the API shows `PENDING` (neither a stored row nor an indexer price). */
    pendingOld: number;
};

export type VersionStatus = {
    version: number;
    state: DeploymentState;
    envioDatabase: string;
    /** When the version was deployed (UTC `YYYY-MM-DD HH:MM:SS.ffffff`): how long it has been building. */
    createdAt: string;
    /** null before the first advance: no watermark yet, nothing stored. */
    watermark: string | null;
    watermarkAgeSeconds: number | null;
    /** The active version only (null for the others, and for one without indexer price columns). */
    headPrices: HeadPriceStatus | null;
};

/**
 * What the status check counts: `PENDING` events older than `pendingAlertSeconds`, within the last `lookbackDays`, in
 * statements sized and limited by `reprice`.
 */
export type StatusSettings = { pendingAlertSeconds: number; lookbackDays: number; reprice: RepriceSettings };

export const lastHourPricingStatement = (envioDatabase: string): Sql => sql`
WITH
${timelineEventsCtes(envioDatabase, 'events', {
    where: sql`block_timestamp >= now64(3) - toIntervalHour(1)`,
    frontier: committedFrontier(envioDatabase),
})}
SELECT count() AS n, countIf(head_price IS NULL) AS unpriced FROM events`;

/**
 * {@link HeadPriceStatus} of a version. The `PENDING` count looks at the events of the last `lookbackDays` (the retry
 * window and a little more): an older event without a stored row is the late-row step's and the retry window's
 * business, and the count must stay cheap enough to run every few minutes.
 */
export const headPriceStatus = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    deployment: Pick<Deployment, 'version' | 'envioDatabase'>,
    { pendingAlertSeconds, lookbackDays, reprice }: StatusSettings
): Promise<HeadPriceStatus> => {
    const [row] = await client.query<{ n: string; unpriced: string }>(
        lastHourPricingStatement(deployment.envioDatabase)
    );
    const events = Number(row?.n ?? 0);
    const unpriced = Number(row?.unpriced ?? 0);
    return {
        lastHourEvents: events,
        lastHourUnpriced: unpriced,
        lastHourUnpricedShare: events === 0 ? null : unpriced / events,
        pendingOld: await pendingEvents(client, schema, deployment, {
            olderThanSeconds: pendingAlertSeconds,
            sinceDays: lookbackDays,
            settings: reprice,
        }),
    };
};

/**
 * Every version not dropped, with its watermark age, and for the active version how its recent events are priced: what
 * the worker logs and alerts on (an old watermark, a version stuck in `building`, a high share of events without an
 * indexer price, `PENDING` events). Needs the pipeline user.
 */
export const versionStatuses = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    settings: StatusSettings
): Promise<VersionStatus[]> => {
    const statuses: VersionStatus[] = [];
    for (const deployment of await listDeployments(client, schema)) {
        if (deployment.state === 'dropped' || deployment.tablesDroppedAt !== null) continue;
        const watermark = await readWatermark(client, schema, deployment.version);
        const headPrices =
            deployment.state === 'active' && (await hasHeadColumns(client, deployment.envioDatabase))
                ? await headPriceStatus(client, schema, deployment, settings)
                : null;
        statuses.push({
            version: deployment.version,
            state: deployment.state,
            envioDatabase: deployment.envioDatabase,
            createdAt: deployment.createdAt,
            watermark: watermark?.watermark ?? null,
            watermarkAgeSeconds:
                watermark === undefined ? null : Math.round((Date.now() - msOf(watermark.watermark)) / 1000),
            headPrices,
        });
    }
    return statuses;
};

/** The active version; its watermark and the watermark's age are null before the version's first advance. */
export type ApiStatus = { version: number; watermark: string | null; watermarkAgeSeconds: number | null };

/**
 * The active version and its watermark age, through the `api_status` view (the API user may read it), as JSON rows:
 * what the pipeline and the tests read (the API reads the same select as Arrow). The version goes into the API's cache
 * keys, so a switch does not serve timelines cached from the old version.
 */
export const apiStatus = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'database'>,
    timeoutMs: number
): Promise<ApiStatus> => {
    const [row] = await client.query<{
        version: number;
        watermark_at: string | null;
        watermark_age_seconds: string | null;
    }>(apiStatusSelect(schema.database), { timeoutMs });
    if (row === undefined) throw new Error('api_status returned no row');
    return {
        version: row.version,
        watermark: row.watermark_at,
        watermarkAgeSeconds: row.watermark_age_seconds === null ? null : Number(row.watermark_age_seconds),
    };
};
