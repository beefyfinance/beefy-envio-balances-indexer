import { type ClickhouseClient, qualified, USER_TIMELINE_PRICED } from '@beefy/clickhouse';

import { isAddress } from '../http/address.ts';
import type { PricedRow } from './build.ts';

export type TimelineRepository = {
    /** Every priced row of one account, oldest first. */
    rows: (account: string) => Promise<PricedRow[]>;
    /** Contracts of Beefy products (vaults, managers, boosts, reward pools): their "timelines" are not a user's. */
    productContracts: () => Promise<string[]>;
};

export const clickhouseTimelineRepository = (
    client: ClickhouseClient,
    analyticsDatabase: string,
    queryTimeoutMs: number
): TimelineRepository => ({
    rows: (account) => {
        // the only value that reaches the SQL text; anything else never gets here, but the query must not depend on that
        if (!isAddress(account) || account !== account.toLowerCase())
            throw new Error('account must be a lower case address');
        return client.query<PricedRow>(
            `SELECT chain_id, toString(toUnixTimestamp64Milli(timestamp)) AS timestamp_ms, block_number, log_index, trx_hash,
                toString(kind) AS kind, contract, source, toString(delta) AS delta, toString(shares_after) AS shares_after,
                toString(amount0) AS amount0, toString(amount1) AS amount1, reward_token, toString(reward_amount) AS reward_amount,
                product_address, product_kind, contract_kind, decimals, share_to_usd, toString(price_flag) AS price_flag,
                price_source, toUnixTimestamp(price_before_at) AS price_before_at, toUnixTimestamp(price_after_at) AS price_after_at,
                usd_delta, usd_after
             FROM ${qualified(analyticsDatabase, USER_TIMELINE_PRICED)} FINAL
             WHERE account = '${account}' AND is_deleted = 0
             ORDER BY timestamp, chain_id, log_index`,
            {},
            { timeoutMs: queryTimeoutMs }
        );
    },
    productContracts: async () => {
        const rows = await client.query<{ contract: string }>(
            `SELECT DISTINCT contract FROM ${qualified(analyticsDatabase, 'contract_product')}`,
            {},
            { timeoutMs: queryTimeoutMs }
        );
        return rows.map(({ contract }) => contract);
    },
});
