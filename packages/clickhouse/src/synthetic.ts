import type { ClickhouseClient } from './client.ts';
import { PRODUCT_SHARE_PRICE } from './pricing.ts';
import { type Databases, qualified } from './sql.ts';
import { USER_TIMELINE } from './timeline.ts';

export type SyntheticSize = {
    accounts: number;
    /** Balance changes in total, spread over the accounts (a few accounts get far more than the average). */
    events: number;
    products: number;
    /** History covered by events and by 15 minute prices, ending now. */
    days: number;
};

export const DEFAULT_SIZE: SyntheticSize = { accounts: 200_000, events: 2_000_000, products: 300, days: 365 };

const CHAIN_ID = 8453;

/** The address of synthetic product `i`, lower case, as the views would write it. */
const productAddress = (column: string): string => `concat('0x', lpad(lower(hex(${column})), 40, '0'))`;

/**
 * Fills a load-test database with plausible volumes: products and their 15 minute prices, and unpriced balance changes
 * in `user_timeline` for the stamping to value. The raw side (`Contract`, `Token`) is filled so `contract_product` works.
 * Event timestamps are uniform over the period with a skew towards a few busy accounts and a few busy products; there is
 * one whale with a hundredth of all events.
 */
export const seedSynthetic = async (client: ClickhouseClient, db: Databases, size: SyntheticSize): Promise<void> => {
    const { accounts, events, products, days } = size;
    const prices = qualified(db.prices, PRODUCT_SHARE_PRICE);

    await client.command(
        `INSERT INTO ${qualified(db.raw, 'Contract')} SELECT ${CHAIN_ID}, ${productAddress('number')}, 'VAULT' FROM numbers(${products})`
    );
    await client.command(
        `INSERT INTO ${qualified(db.raw, 'Token')} SELECT ${CHAIN_ID}, ${productAddress('number')}, 18 FROM numbers(${products})`
    );

    // a slowly drifting price per product, one row per 15 minutes; the first day of history is missing for half the products
    await client.command(
        `INSERT INTO ${prices}
         SELECT ${CHAIN_ID}, ${productAddress('product')}, concat('synthetic:', toString(product)),
             toDateTime(toUInt32(toUnixTimestamp(now()) - ${days} * 86400 + step * 900), 'UTC'),
             toDecimal256(1 + product % 7 + 0.0001 * step, 20), 'synthetic', 1
         FROM (SELECT number AS product FROM numbers(${products})) AS p
         CROSS JOIN (SELECT number AS step FROM numbers(${days * 96})) AS s
         WHERE NOT (product % 2 = 1 AND step < 96)`
    );

    // skew: cubing a uniform number concentrates events on low account and product numbers
    await client.command(
        `INSERT INTO ${qualified(db.analytics, USER_TIMELINE)}
         (account, chain_id, timestamp, block_number, log_index, trx_hash, kind, contract, source, delta, shares_after,
          amount0, amount1, reward_token, reward_amount, event_id, version, is_deleted)
         SELECT
             if(number % 100 = 0, '0xwhale', concat('0x', lpad(lower(hex(toUInt64(pow(rand() / 4294967295, 3) * ${accounts}))), 40, '0'))) AS account,
             ${CHAIN_ID}, toDateTime64(toUnixTimestamp(now()) - rand() % (${days} * 86400), 3, 'UTC') AS timestamp,
             number AS block_number, toUInt32(number % 500) AS log_index, concat('0x', lower(hex(number))) AS trx_hash,
             'BALANCE', ${productAddress(`toUInt64(pow(rand() / 4294967295, 2) * ${products})`)} AS contract, 'TRANSFER',
             toInt256(rand() % 2000000000000000000) - 1000000000000000000 AS delta, toUInt256(rand()) * 1000000000 AS shares_after,
             toUInt256(0), toUInt256(0), '', toUInt256(0), toString(number) AS event_id, 1, 0
         FROM numbers(${events})`
    );
};
