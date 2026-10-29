import * as R from 'remeda';
import { describe, expect, it } from 'vitest';

import {
    migrateStatements,
    repriceStatement,
    updateDeploymentStatement,
    writeWatermarkStatement,
} from './deployments.ts';
import { committedFrontier, frontierValue, timelineEventsCtes } from './events.ts';
import { pricedEventsCtes } from './pricing.ts';
import { type Schema, sql } from './sql.ts';
import {
    apiViewNames,
    apiViews,
    timelineColumns,
    userTimelineApiView,
    versionOfTable,
    versionTables,
} from './timeline.ts';

const schema: Schema = {
    database: 'beefy_indexer_dev',
    prices: { price5m: 'analytics.asset_price_5m', token: 'analytics.token' },
    watermarkPriceSources: ['api', 'beefy_db'],
    envioDatabasePrefix: 'envio_dev_',
};
const active = { version: 4, envioDatabase: 'envio_dev_4' };

/** How often each CTE `name` is referenced after its definition (ClickHouse plans a CTE again at every reference). */
const references = (text: string, name: string): number =>
    text.split(new RegExp(`\\b(?:FROM|JOIN|IN)\\s+\`?${name}\\b\`?`)).length - 1;

/** The CTEs a statement defines (`name AS` alone on its line, the name quoted or not). */
const ctes = (text: string): string[] => [...text.matchAll(/^`?(\w+)`? AS\s*$/gm)].map(([, name]) => name ?? '');

describe('events', () => {
    it('filters before keeping the latest row per id, so a filter on account reads the sort key range', () => {
        const { text } = timelineEventsCtes('envio_dev_4', 'events', {
            where: sql`account = {account:String}`,
            frontier: committedFrontier('envio_dev_4'),
        });
        const filter = text.indexOf('account = {account:String}');
        expect(filter).toBeGreaterThan(0);
        expect(filter).toBeLessThan(text.indexOf('LIMIT 1 BY id, chain_id'));
        expect(text.indexOf('envio_checkpoint_id <= envio_frontier[chain_id]')).toBeLessThan(
            text.indexOf('LIMIT 1 BY')
        );
        // the SET filter applies after the deduplication; it is a guard only, since Envio's DELETE rows have an empty
        // account and are filtered out before (TimelineEvent is never deleted, see events.ts)
        expect(text.lastIndexOf("envio_change = 'SET'")).toBeGreaterThan(text.indexOf('LIMIT 1 BY'));
        expect(text).toContain('`envio_dev_4`.`envio_chains` FINAL');
        expect(text).toMatch(/^\s*`events_history` AS/);
        expect(text).not.toMatch(/FROM\s*\(\s*SELECT/);
    });
});

describe('API views', () => {
    it('name the active version: its Envio database and its stored prices, in our stable database', () => {
        const { text } = userTimelineApiView(schema, active);
        expect(text).toMatch(/^\s*CREATE VIEW `beefy_indexer_dev`.`user_timeline_api` AS/);
        expect(text).toContain('`envio_dev_4`.`envio_history_TimelineEvent`');
        expect(text).toContain('`beefy_indexer_dev`.`event_price_4` FINAL');
        expect(text).toContain('account = {account:String}');
        // the API user is readonly and may not change any setting, the view included
        expect(text).not.toMatch(/\bSETTINGS\b/);
        for (const column of timelineColumns()) expect(text).toContain(column);
    });

    it('run as the definer when one is configured', () => {
        for (const view of apiViews({ ...schema, definer: 'beefy_pipeline' }, active)) {
            expect(view.create(`${view.name}_next`).text).toContain(
                `\`${view.name}_next\`\nDEFINER = \`beefy_pipeline\` SQL SECURITY DEFINER AS`
            );
        }
        expect(apiViews(schema, active).map(({ name }) => name)).toEqual(apiViewNames());
    });

    it('only look prices up, with named CTEs each referenced once and no sub-select in a FROM', () => {
        const view = userTimelineApiView(schema, active).text;
        // no pricing SQL, no product facts, no price table, no watermark: planning stays small
        for (const absent of ['px_', 'Contract', 'Token', 'analytics.', 'price_watermark'])
            expect(view).not.toContain(absent);
        expect(view.split('envio_history_TimelineEvent').length).toBe(2);
        expect(view.split('event_price_4').length).toBe(2);
        for (const cte of ['events_history', 'events', 'stored']) expect(references(view, cte)).toBe(1);
        expect(view).not.toMatch(/(?:FROM|JOIN)\s*\(\s*SELECT/);
        expect(view).toContain(
            "multiIf(s.found = 1, s.price_flag, e.head_price IS NOT NULL, 'PROVISIONAL', 'PENDING') AS `price_flag`"
        );
        expect(view).toContain('ON s.event_id = e.event_id AND s.timestamp = e.timestamp');
    });

    it('build every view from named CTEs, each referenced once', () => {
        for (const view of apiViews(schema, active)) {
            const { text } = view.create(view.name);
            expect(text).not.toMatch(/(?:FROM|JOIN)\s*\(\s*SELECT/);
            for (const name of ctes(text)) expect(references(text, name)).toBe(1);
        }
    });
});

describe('reprice statement', () => {
    const range = { from: '2024-01-01 00:00:00.000', to: '2024-01-08 00:00:00.000' };

    it('carries every value as a parameter: the range, the frontier, the filter', () => {
        const { text, params } = repriceStatement(schema, active, { 8453: '12' }, range, { where: sql`1` });
        expect(text).toMatch(/^\s*INSERT INTO `beefy_indexer_dev`.`event_price_4`/);
        expect(text).toContain('WITH {p_0:Map(Int32, UInt64)} AS envio_frontier');
        expect(text).toContain(
            "`block_timestamp` >= {p_1:DateTime64(3, 'UTC')} AND `block_timestamp` < {p_2:DateTime64(3, 'UTC')}"
        );
        expect(text).not.toContain('2024-01-01');
        expect(params).toEqual({ p_0: new Map([[8453, 12n]]), p_1: range.from, p_2: range.to });
        expect(text).toMatch(/FROM px_priced$/);
    });

    it('compares with the stored rows of the same range when asked, and filters the latest row after the deduplication', () => {
        const { text, params } = repriceStatement(
            schema,
            active,
            {},
            { from: range.from },
            { where: sql`1`, latest: sql`head_price IS NULL`, changedOnly: true }
        );
        expect(text.indexOf("envio_change = 'SET' AND (head_price IS NULL)")).toBeGreaterThan(
            text.indexOf('LIMIT 1 BY id, chain_id')
        );
        expect(text).toContain('WHERE (account, event_id, timestamp, toString(tuple(');
        expect(text).toContain('NOT IN stored_results');
        expect(text).toMatch(/FINAL WHERE `timestamp` >= \{p_\d+:DateTime64\(3, 'UTC'\)\}\n/);
        expect(R.values(params)).not.toContain(undefined);
        expect(text).not.toContain('`block_timestamp` <');
    });

    it('prices from the 5 minute table only, with named CTEs and no sub-select in a FROM', () => {
        const { text } = pricedEventsCtes(schema.prices, 'envio_dev_4', 'events');
        expect(text).toContain('`analytics`.`asset_price_5m`');
        for (const absent of ['asset_price_1h', 'asset_price_1d', 'bar', "'1h'", "'1d'", 'LIMIT 1 BY event_id'])
            expect(text).not.toContain(absent);
        expect(text).not.toMatch(/(?:FROM|JOIN)\s*\(\s*SELECT/);
        for (const name of ctes(text)) {
            // px_days feeds one scalar subquery, written twice and run once; px_rows feeds it and the price lookup (a
            // background statement: planning it twice costs nothing that matters, unlike in the API view); px_priced is the
            // caller's
            const expected = name === 'px_days' || name === 'px_rows' ? 2 : name === 'px_priced' ? 0 : 1;
            expect(references(text, name)).toBe(expected);
        }
    });
});

describe('statements with values', () => {
    it('send the deployment changes and watermarks as parameters', () => {
        const update = updateDeploymentStatement(schema, 3, { state: 'retired', now: ['retired_at'] });
        expect(update.text).toContain('{p_0:String}');
        expect(update.text).toContain('WHERE version = {p_1:UInt32}');
        expect(update.params).toEqual({ p_0: 'retired', p_1: 3 });
        const watermark = writeWatermarkStatement(schema, 3, { watermark: '2024-01-01', checkpoints: { 1: '5' } });
        expect(watermark.params).toEqual({ p_0: '2024-01-01 00:00:00.000', p_1: new Map([[1, 5n]]) });
        expect(() => writeWatermarkStatement(schema, 3, { watermark: "2024-01-01'; DROP", checkpoints: {} })).toThrow(
            'time must be'
        );
    });

    it('refuse frontier entries that are not numbers', () => {
        expect(frontierValue({ 8453: '12', 42161: '7' })).toEqual(
            new Map([
                [8453, 12n],
                [42161, 7n],
            ])
        );
        for (const [chain, checkpoint] of [
            ['1) OR (1', '1'],
            ['1', '1; DROP'],
            ['1', '`x`'],
            ['{a}', '1'],
        ] as const) {
            expect(() => frontierValue({ [chain]: checkpoint })).toThrow('invalid frontier entry');
        }
    });
});

describe('versions', () => {
    it('keeps every object of a version in tables suffixed with its number', () => {
        expect(versionTables(4)).toEqual(['event_price_4', 'price_watermark_4']);
        for (const table of versionTables(12)) expect(versionOfTable(table)).toBe(12);
        for (const name of ['deployments', 'user_timeline_api_next', 'event_price_04', 'event_price_1x']) {
            expect(versionOfTable(name)).toBeUndefined();
        }
        expect(() => versionTables(0)).toThrow('version must be');
    });

    it('creates our database first', () => {
        expect(migrateStatements(schema)[0]?.text).toBe('CREATE DATABASE IF NOT EXISTS `beefy_indexer_dev`');
    });
});
