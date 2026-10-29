import { type ApiStatus, apiStatusSelect, type ClickhouseClient, sql } from '@beefy/clickhouse';

import { decodeArrow } from './lib/arrow.ts';

type StatusRow = { version: number; watermark_at: string | null; watermark_age_seconds: number | null };

/**
 * The active version and its watermark age, read from the `api_status` view in `ArrowStream`. The version goes into
 * the cache keys, so a switch does not serve timelines cached from the old version.
 */
export const readApiStatus = async (
    client: ClickhouseClient,
    database: string,
    timeoutMs: number
): Promise<ApiStatus> => {
    const [row] = await decodeArrow<StatusRow>(
        await client.stream(sql`${apiStatusSelect(database)}\nFORMAT ArrowStream`, { timeoutMs }),
        {
            version: { kind: 'integer' },
            watermark_at: { kind: 'string', nullable: true },
            watermark_age_seconds: { kind: 'integer', nullable: true },
        }
    );
    if (row === undefined) throw new Error('api_status returned no row');
    return { version: row.version, watermark: row.watermark_at, watermarkAgeSeconds: row.watermark_age_seconds };
};
