import type { VersionStatus } from '@beefy/clickhouse';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureLog } from '../lib/log.testing.ts';
import { advanceJob } from './advance.ts';
import { cleanupJob } from './cleanup.ts';
import { type ReportLine, versionReport, versionStatusJob } from './versionStatus.ts';

afterEach(() => vi.restoreAllMocks());

const signal = new AbortController().signal;
const NOW = Date.parse('2026-10-29T12:00:00Z');
const THRESHOLDS = { watermarkAlertSeconds: 2 * 86_400, unpricedShareAlert: 0.5, buildingAlertHours: 168 };

const status = (overrides: Partial<VersionStatus> = {}): VersionStatus => ({
    version: 1,
    state: 'active',
    envioDatabase: 'envio_dev_1',
    createdAt: '2026-10-01 00:00:00.000000',
    watermark: '2026-10-28 06:00:00.000',
    watermarkAgeSeconds: 108_000,
    headPrices: null,
    ...overrides,
});

const warnings = (lines: ReportLine[]): string[] => lines.filter((l) => l.level === 'warn').map((l) => l.event);

describe('advance job', () => {
    it('logs where each version moved, and the versions whose Envio database is not there yet', async () => {
        const lines = captureLog();
        const job = advanceJob({
            intervalMinutes: 15,
            advance: () =>
                Promise.resolve([
                    { version: 1, from: '2026-10-27 00:00:00.000', to: '2026-10-28 00:00:00.000', statements: 2 },
                    { version: 2, waiting: 'no-envio-database', statements: 0 },
                    { version: 3, waiting: 'no-events', statements: 0 },
                    {
                        version: 4,
                        superseded: true,
                        from: '2026-10-01 00:00:00.000',
                        to: '2026-10-08 00:00:00.000',
                        statements: 2,
                    },
                    {
                        version: 5,
                        unsupported: 'event_price_5 has no facts_complete column (deployed before it)',
                        statements: 0,
                    },
                ]),
        });
        expect(job).toMatchObject({ name: 'advance', intervalMs: 900_000 });
        await job.run(signal);
        expect(lines).toEqual([
            {
                event: 'watermark-advanced',
                version: 1,
                from: '2026-10-27 00:00:00.000',
                to: '2026-10-28 00:00:00.000',
                statements: 2,
            },
            { event: 'watermark-waiting', version: 2, reason: 'the Envio database does not exist yet' },
            { event: 'watermark-waiting', version: 3, reason: 'Envio has committed no event yet' },
            {
                event: 'watermark-superseded',
                version: 4,
                from: '2026-10-01 00:00:00.000',
                to: '2026-10-08 00:00:00.000',
                statements: 2,
                reason: 'rewound meanwhile',
            },
            {
                event: 'version-unsupported',
                level: 'warn',
                version: 5,
                reason: 'event_price_5 has no facts_complete column (deployed before it)',
            },
        ]);
    });
});

describe('cleanup job', () => {
    it('logs what it dropped, and warns about what it kept, refused, or does not know, without touching it', async () => {
        const lines = captureLog();
        const job = cleanupJob({
            intervalHours: 24,
            cleanup: () =>
                Promise.resolve({
                    dropped: ['version 3: tables', 'version 3: envio_dev_3'],
                    inUse: ['version 4: user_timeline_api_next'],
                    refused: ['version 5: default: a database cleanup never drops'],
                    unknownDatabases: ['envio_dev_9'],
                    unknownTables: ['event_price_9'],
                }),
        });
        expect(job).toMatchObject({ name: 'cleanup', intervalMs: 86_400_000 });
        await job.run(signal);
        expect(lines.map((l) => [l.event, l.level])).toEqual([
            ['version-dropped', undefined],
            ['version-dropped', undefined],
            ['version-in-use', 'warn'],
            ['drop-refused', 'warn'],
            ['unknown-database', 'warn'],
            ['unknown-table', 'warn'],
        ]);
        expect(lines[2]).toMatchObject({ version: 'version 4: user_timeline_api_next' });
        expect(lines[3]).toMatchObject({ database: 'version 5: default: a database cleanup never drops' });
        expect(lines[4]).toMatchObject({ database: 'envio_dev_9' });
        expect(lines[5]).toMatchObject({ table: 'event_price_9' });
    });
});

describe('version status', () => {
    it('reports every version and warns about nothing while all is well', () => {
        const lines = versionReport([status()], THRESHOLDS, NOW);
        expect(lines).toEqual([
            {
                event: 'version-status',
                version: 1,
                state: 'active',
                envioDatabase: 'envio_dev_1',
                watermark: '2026-10-28 06:00:00.000',
                watermarkAgeSeconds: 108_000,
            },
        ]);
    });

    it('warns about an old watermark', () => {
        const old = versionReport([status({ watermarkAgeSeconds: 2 * 86_400 + 1 })], THRESHOLDS, NOW);
        expect(warnings(old)).toEqual(['watermark-old']);
    });

    it('treats no watermark yet as pending, and warns only when it lasts longer than the alert outside building', () => {
        const pending = { watermark: null, watermarkAgeSeconds: null };
        const fresh = versionReport([status({ ...pending, createdAt: '2026-10-29 06:00:00.000000' })], THRESHOLDS, NOW);
        expect(warnings(fresh)).toEqual([]);
        expect(fresh[0]).toMatchObject({ event: 'version-status', watermark: null, watermarkAgeSeconds: null });
        expect(warnings(versionReport([status(pending)], THRESHOLDS, NOW))).toEqual(['watermark-missing']);
        expect(warnings(versionReport([status({ ...pending, state: 'building' }), status()], THRESHOLDS, NOW))).toEqual(
            ['version-stuck-building']
        );
    });

    it('warns about a version building for too long, not one that just started', () => {
        const building = (createdAt: string): VersionStatus =>
            status({ version: 2, state: 'building', createdAt, watermark: null, watermarkAgeSeconds: null });
        expect(warnings(versionReport([status(), building('2026-10-28 12:00:00.000000')], THRESHOLDS, NOW))).toEqual(
            []
        );
        const stuck = versionReport([status(), building('2026-10-20 12:00:00.000000')], THRESHOLDS, NOW);
        expect(warnings(stuck)).toEqual(['version-stuck-building']);
        expect(stuck.find((l) => l.event === 'version-stuck-building')).toMatchObject({
            version: 2,
            buildingHours: 216,
        });
    });

    it('reports how the active version prices its recent events, and warns on a stopped price cache or old PENDING events', () => {
        const head = { lastHourEvents: 40, lastHourUnpriced: 4, lastHourUnpricedShare: 0.1, pendingOld: 0 };
        const fine = versionReport([status({ headPrices: head })], THRESHOLDS, NOW);
        expect(warnings(fine)).toEqual([]);
        expect(fine[0]).toMatchObject({ event: 'version-status', ...head });
        const stopped = versionReport(
            [status({ headPrices: { ...head, lastHourUnpriced: 30, lastHourUnpricedShare: 0.75 } })],
            THRESHOLDS,
            NOW
        );
        expect(warnings(stopped)).toEqual(['indexer-prices-missing']);
        expect(stopped[1]).toMatchObject({ version: 1, lastHourEvents: 40, lastHourUnpricedShare: 0.75 });
        const quiet = { lastHourEvents: 0, lastHourUnpriced: 0, lastHourUnpricedShare: null, pendingOld: 3 };
        const pending = versionReport([status({ headPrices: quiet })], THRESHOLDS, NOW);
        expect(warnings(pending)).toEqual(['pending-events-old']);
        expect(pending[1]).toMatchObject({ version: 1, pendingOld: 3 });
    });

    it('warns when no version is active', () => {
        expect(warnings(versionReport([status({ state: 'ready' })], THRESHOLDS, NOW))).toEqual(['no-active-version']);
        expect(warnings(versionReport([], THRESHOLDS, NOW))).toEqual(['no-active-version']);
    });

    it('runs the report on its interval', async () => {
        const lines = captureLog();
        const job = versionStatusJob({
            intervalMinutes: 5,
            thresholds: THRESHOLDS,
            read: () => Promise.resolve([status({ watermarkAgeSeconds: 3 * 86_400 })]),
            now: () => NOW,
        });
        expect(job).toMatchObject({ name: 'version-status', intervalMs: 300_000 });
        await job.run(signal);
        expect(lines.map((l) => l.event)).toEqual(['version-status', 'watermark-old']);
    });
});
