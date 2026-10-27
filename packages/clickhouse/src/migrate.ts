import type { ClickhouseClient } from './client.ts';
import { USER_TIMELINE_PRICED, repairView, stampView, userTimelinePricedTable } from './pricing.ts';
import { type Databases, identifier } from './sql.ts';
import {
    backfillStatements,
    contractProductView,
    dropProjectionViews,
    projectionViews,
    queueTables,
    queueViews,
    userTimelineTable,
} from './timeline.ts';

/** Objects that only need our own database: safe to create before the indexer has written anything. */
export const analyticsStatements = (db: Databases): string[] => [
    `CREATE DATABASE IF NOT EXISTS ${identifier(db.analytics)}`,
    userTimelineTable(db),
    userTimelinePricedTable(db),
    ...queueTables(db),
    ...queueViews(db, USER_TIMELINE_PRICED),
];

/**
 * Objects that read the indexer's database, so they need it to exist. Dropped and recreated on purpose: after a reindex
 * Envio has a new raw database and these must point at it.
 */
export const attachStatements = (db: Databases): string[] => [
    ...dropProjectionViews(db),
    ...projectionViews(db),
    contractProductView(db),
    // after the view they read; they need the price database to exist too
    stampView(db),
    repairView(db),
];

export const migrate = async (client: ClickhouseClient, db: Databases): Promise<void> => {
    for (const statement of analyticsStatements(db)) {
        await client.command(statement);
    }
};

/** Creates the views over the raw database, then loads the rows it already holds. */
export const attach = async (client: ClickhouseClient, db: Databases): Promise<void> => {
    for (const statement of attachStatements(db)) {
        await client.command(statement);
    }
    for (const statement of backfillStatements(db)) {
        await client.command(statement);
    }
};
