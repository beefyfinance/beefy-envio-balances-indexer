import { describe, expect, it } from 'vitest';

import { attachStatements, analyticsStatements } from './migrate.ts';
import { identifier } from './sql.ts';
import { backfillStatements, projectionNames, projectionViews } from './timeline.ts';

const db = { raw: 'beefy_raw', analytics: 'beefy_analytics', prices: 'dbt' };

describe('identifier', () => {
    it('quotes valid names and refuses anything that could alter a statement', () => {
        expect(identifier('beefy_raw')).toBe('`beefy_raw`');
        expect(() => identifier('a; DROP DATABASE x')).toThrow('invalid ClickHouse identifier');
        expect(() => identifier('a`b')).toThrow('invalid ClickHouse identifier');
        expect(() => identifier('')).toThrow('invalid ClickHouse identifier');
    });
});

describe('user_timeline statements', () => {
    it('has one projection view and one backfill per raw table, all reading the raw database', () => {
        const views = projectionViews(db);
        expect(views).toHaveLength(projectionNames.length);
        expect(backfillStatements(db)).toHaveLength(projectionNames.length);
        for (const sql of [...views, ...backfillStatements(db)]) {
            expect(sql).toContain('`beefy_raw`.`envio_history_');
            expect(sql).not.toMatch(/\bJOIN\b/i);
        }
    });

    it('turns Envio rollback rows into tombstones of the same key', () => {
        for (const sql of projectionViews(db)) {
            expect(sql).toContain("toUInt8(envio_change = 'DELETE') AS is_deleted");
            expect(sql).toContain('envio_checkpoint_id AS version');
        }
    });

    it('creates our database first and only ever writes to it (the raw one is read, never changed)', () => {
        expect(analyticsStatements(db)[0]).toBe('CREATE DATABASE IF NOT EXISTS `beefy_analytics`');
        const statements = [...analyticsStatements(db).slice(1), ...attachStatements(db), ...backfillStatements(db)];
        for (const sql of statements) {
            // the first qualified name of a CREATE, DROP or INSERT is its target
            expect(/`(\w+)`\.`\w+`/.exec(sql)?.[1]).toBe('beefy_analytics');
        }
    });

    it('recreates the views on attach so they follow a new raw database', () => {
        const [first] = attachStatements(db);
        expect(first).toMatch(/^DROP VIEW IF EXISTS/);
    });
});
