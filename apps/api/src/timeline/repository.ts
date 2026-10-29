import {
    type ClickhouseClient,
    param,
    productContractsSelect,
    qualified,
    type Sql,
    sql,
    userTimelineApi,
} from '@beefy/clickhouse';
import * as R from 'remeda';

import { isAddress } from '../http/address.ts';
import { type ColumnSpec, decodeArrow } from '../lib/arrow.ts';
import type { PricedRow } from './build.ts';

/** The account has more rows than one response can hold: the origin refuses it rather than build it. */
export class TimelineTooLargeError extends Error {
    readonly maxRows: number;
    constructor(maxRows: number) {
        super(`timeline has more than ${maxRows} rows`);
        this.name = 'TimelineTooLargeError';
        this.maxRows = maxRows;
    }
}

export type TimelineRepository = {
    /** Every priced row of one account, oldest first. */
    rows: (account: string) => Promise<PricedRow[]>;
    /** Contracts of Beefy products (vaults, managers, boosts, reward pools): their "timelines" are not a user's. */
    productContracts: () => Promise<string[]>;
};

/**
 * The columns of `user_timeline_api` the API reads, as ClickHouse returns them in `ArrowStream` (see lib/arrow.ts): the
 * values the rows had when they were read as JSON, so the responses do not change. `kind` is an enum in Envio's table,
 * whose names Arrow does not carry: it is the one column converted by ClickHouse (`toString`).
 */
const TIMELINE_COLUMNS: ColumnSpec<PricedRow> = {
    chain_id: { kind: 'number' },
    timestamp_ms: { kind: 'ms-string' },
    block_number: { kind: 'bigint-string' },
    log_index: { kind: 'number' },
    trx_hash: { kind: 'string' },
    kind: { kind: 'string' },
    contract: { kind: 'string' },
    source: { kind: 'string' },
    delta: { kind: 'int256-string' },
    shares_after: { kind: 'uint256-string' },
    amount0: { kind: 'uint256-string' },
    amount1: { kind: 'uint256-string' },
    reward_token: { kind: 'string' },
    reward_amount: { kind: 'uint256-string' },
    product_address: { kind: 'string' },
    product_kind: { kind: 'string' },
    contract_kind: { kind: 'string' },
    decimals: { kind: 'number' },
    share_to_usd: { kind: 'number' },
    price_flag: { kind: 'string' },
    price_source: { kind: 'string' },
    price_resolution: { kind: 'string' },
    price_before_at: { kind: 'number', nullable: true },
    price_after_at: { kind: 'number', nullable: true },
    usd_delta: { kind: 'number' },
    usd_after: { kind: 'number' },
};

/**
 * The timeline query: the view's columns as they are (no formatting in ClickHouse), at most `limit` rows, unordered, in
 * `ArrowStream`. The account and the limit are query parameters.
 */
export const timelineSelect = (database: string, account: string, limit: number): Sql => sql`
SELECT chain_id, timestamp AS timestamp_ms, block_number, log_index, trx_hash, toString(kind) AS kind, contract, source,
    delta, shares_after, amount0, amount1, reward_token, reward_amount, product_address, product_kind, contract_kind,
    decimals, share_to_usd, price_flag, price_source, price_resolution, price_before_at, price_after_at, usd_delta, usd_after
FROM ${qualified(database, userTimelineApi())}(account = ${param('String', account)})
LIMIT ${param('UInt32', limit)}
FORMAT ArrowStream`;

/** Oldest first, as the builder needs them; sorted here rather than by ClickHouse (API servers are the ones that scale). */
const chronological = (a: PricedRow, b: PricedRow): number =>
    Number(a.timestamp_ms) - Number(b.timestamp_ms) || a.chain_id - b.chain_id || a.log_index - b.log_index;

export const clickhouseTimelineRepository = (
    client: ClickhouseClient,
    analyticsDatabase: string,
    queryTimeoutMs: number,
    maxRows: number
): TimelineRepository => ({
    rows: async (account) => {
        // a parameter, never SQL text; checked anyway, since a malformed account has no timeline to read
        if (!isAddress(account) || account !== account.toLowerCase())
            throw new Error('account must be a lower case address');
        const stream = await client.stream(timelineSelect(analyticsDatabase, account, maxRows + 1), {
            timeoutMs: queryTimeoutMs,
        });
        const rows = await decodeArrow(stream, TIMELINE_COLUMNS);
        // one more than allowed was asked for: that is how an account over the limit is told from one at it
        if (rows.length > maxRows) throw new TimelineTooLargeError(maxRows);
        return rows.sort(chronological);
    },
    productContracts: async () => {
        const stream = await client.stream(sql`${productContractsSelect(analyticsDatabase)}\nFORMAT ArrowStream`, {
            timeoutMs: queryTimeoutMs,
        });
        return R.map(
            await decodeArrow<{ contract: string }>(stream, { contract: { kind: 'string' } }),
            ({ contract }) => contract
        );
    },
});
