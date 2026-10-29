import type { ClickhouseClient } from './client.ts';
import { envioChainsTable, timelineEventHistoryTable } from './events.ts';
import { priceStubs } from './pricing.ts';
import {
    type Identifier,
    type Schema,
    type Sql,
    databaseOf,
    ident,
    param,
    qualified,
    qualifiedName,
    sql,
} from './sql.ts';

export type SyntheticSize = {
    accounts: number;
    /** Balance changes in total, spread over the accounts (a few accounts get far more than the average). */
    events: number;
    /** Products (vaults), each its own price asset. */
    products: number;
    /** History covered by events and by 5 minute prices, ending now. */
    days: number;
};

export const defaultSyntheticSize = (): SyntheticSize => ({
    accounts: 200_000,
    events: 2_000_000,
    products: 300,
    days: 365,
});

const CHAIN_ID = 8453;
/** Events and price rows are inserted in blocks of this many, so a large load never needs one giant block in memory. */
const CHUNK = 10_000_000;
const LONG_MS = 3_600_000;

/** The address of synthetic product `column`, lower case, as the indexer would write it. */
const productAddress = (column: Identifier): Sql => sql`concat('0x', lpad(lower(hex(${column})), 40, '0'))`;

export const seedSynthetic = async (
    client: ClickhouseClient,
    schema: Pick<Schema, 'prices'>,
    envioDatabase: string,
    { accounts, events, products, days }: SyntheticSize
): Promise<void> => {
    const prices = qualifiedName(schema.prices.price5m);
    const long = { timeoutMs: LONG_MS, settings: { max_insert_threads: 4 } };
    const chain = param('Int32', CHAIN_ID);
    const productCount = param('UInt64', products);
    const address = productAddress(ident('number'));

    for (const database of new Set([databaseOf(schema.prices.price5m), databaseOf(schema.prices.token)])) {
        await client.command(sql`CREATE DATABASE IF NOT EXISTS ${ident(database)}`);
    }
    for (const statement of priceStubs(schema.prices)) await client.command(statement);

    await client.command(
        sql`INSERT INTO ${qualified(envioDatabase, 'Contract')}
         SELECT ${chain}, ${address}, 'VAULT' FROM numbers(${productCount})`
    );
    await client.command(
        sql`INSERT INTO ${qualified(envioDatabase, 'Token')}
         SELECT ${chain}, ${address}, 18 FROM numbers(${productCount})`
    );
    // each vault is its own want, so its facts are complete
    await client.command(
        sql`INSERT INTO ${qualified(envioDatabase, 'ContractLink')}
         SELECT ${chain}, ${address}, ${address}, 'VAULT_WANT', 0 FROM numbers(${productCount})`
    );
    // product i is price asset i + 1
    await client.command(
        sql`INSERT INTO ${qualifiedName(schema.prices.token)}
         SELECT ${chain}, ${address}, 18, number + 1 FROM numbers(${productCount})`
    );

    // a slowly drifting price per product, one row per 5 minutes; the first day of history is missing for half the
    // products. Inserted a block of products at a time.
    const steps = days * 288;
    const productsPerChunk = Math.max(1, Math.floor(CHUNK / steps));
    for (let first = 0; first < products; first += productsPerChunk) {
        await client.command(
            sql`INSERT INTO ${prices}
             WITH
             products AS (SELECT number AS product FROM numbers(${param('UInt64', first)}, ${param('UInt64', Math.min(productsPerChunk, products - first))})),
             steps AS (SELECT number AS step FROM numbers(${param('UInt64', steps)}))
             SELECT product + 1, toDateTime(toUInt32(toUnixTimestamp(now()) - ${param('UInt32', days)} * 86400 + step * 300), 'UTC'),
                 toDecimal256(1 + product % 7 + 0.0001 * step, 20), 'api'
             FROM products CROSS JOIN steps
             WHERE NOT (product % 2 = 1 AND step < 288)`,
            long
        );
    }

    // skew: cubing a uniform number concentrates events on low account and product numbers
    for (let from = 0; from < events; from += CHUNK) {
        await client.command(
            sql`INSERT INTO ${qualified(envioDatabase, timelineEventHistoryTable())}
             (id, chain_id, account, kind, contract, source, delta, shares_after, amount0, amount1, reward_token,
              reward_amount, block_number, block_timestamp, log_index, trx_hash, envio_checkpoint_id, envio_change,
              head_price, head_price_at, head_product, head_decimals, head_product_kind, head_contract_kind)
             WITH
             drawn AS
             (
                 SELECT number, toUInt64(pow(rand() / 4294967295, 2) * ${productCount}) AS product,
                     toDateTime64(toUnixTimestamp(now()) - rand(1) % (${param('UInt32', days)} * 86400), 3, 'UTC') AS at,
                     at >= now() - INTERVAL 1 DAY AS recent
                 FROM numbers(${param('UInt64', from)}, ${param('UInt64', Math.min(CHUNK, events - from))})
             )
             SELECT
                 toString(number) AS id, ${chain},
                 if(number % 100 = 0, '0xwhale', concat('0x', lpad(lower(hex(toUInt64(pow(rand() / 4294967295, 3) * ${param('UInt64', accounts)}))), 40, '0'))) AS account,
                 'BALANCE', ${productAddress(ident('product'))} AS contract, 'TRANSFER',
                 toString(toInt256(rand() % 2000000000000000000) - 1000000000000000000) AS delta,
                 toString(toUInt256(rand()) * 1000000000) AS shares_after, '0', '0', '', '0',
                 number AS block_number, at, toInt32(number % 500), concat('0x', lower(hex(number))), 1, 'SET',
                 if(recent, toNullable(toFloat64(1 + product % 7)), NULL), if(recent, toNullable(at), NULL),
                 contract, toInt32(18), 'VAULT', 'VAULT'
             FROM drawn`,
            long
        );
    }
    await client.insert(qualified(envioDatabase, envioChainsTable()), [{ chain_id: CHAIN_ID, checkpoint_id: 1 }]);
};
