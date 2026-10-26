import { type Job, NotImplementedError } from './job.ts';

/**
 * Copies token and share prices (15 minute resolution, with gaps) from the read-only TimescaleDB on Tiger Cloud into the
 * ClickHouse analytics database, with a timestamp watermark and a small overlap for late rows.
 */
export const priceSyncJob = ({ intervalMinutes }: { intervalMinutes: number }): Job => ({
    name: 'price-sync',
    intervalMs: intervalMinutes * 60_000,
    run: async () => {
        throw new NotImplementedError('price-sync');
    },
});
