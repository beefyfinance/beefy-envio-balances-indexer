/** Identifiers end up in DDL text, so they are validated, not escaped. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const identifier = (name: string): string => {
    if (!IDENTIFIER.test(name)) {
        throw new Error(`invalid ClickHouse identifier: ${JSON.stringify(name)}`);
    }
    return `\`${name}\``;
};

/** `database.table`, both validated and quoted. */
export const qualified = (database: string, table: string): string => `${identifier(database)}.${identifier(table)}`;

export type Databases = {
    /** Written by the indexer; Envio drops it on a reindex. Only read from here. */
    raw: string;
    /** Ours: survives a reindex. */
    analytics: string;
    /** Owned by the databarn dbt project: `int_product_share_price` is read, never written (except by tests and dev seeds). */
    prices: string;
};
