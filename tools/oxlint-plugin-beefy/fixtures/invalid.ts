// Code `beefy/no-untagged-sql` reports: each reported line ends with `// expect: <messageId>` (or follows `// expect-next-line: <messageId>`) (see ../rule.test.js).
declare const sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
declare const raw: (text: string) => unknown;
declare const gql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
declare const table: string;
declare const where: string;
declare const name: string;
declare const conditions: string[];

// 1. Untagged SQL templates, with or without expressions, statements and fragments.
export const t1 = `SELECT * FROM ${table} WHERE ${where}`; // expect: untaggedTemplate
export const t2 = `SELECT 1 FROM system.one`; // expect: untaggedTemplate
export const t3 = `select token, balance from ${table} where chain_id = 1`; // expect: untaggedTemplate
export const t4 = `INSERT INTO ${table} (a) VALUES (1)`; // expect: untaggedTemplate
export const t5 = `CREATE TABLE IF NOT EXISTS ${table} (x UInt8) ENGINE = Memory`; // expect: untaggedTemplate
export const t6 = `CREATE SETTINGS PROFILE IF NOT EXISTS ${name} SETTINGS readonly = 1`; // expect: untaggedTemplate
export const t7 = `ALTER TABLE ${table} DELETE WHERE 1`; // expect: untaggedTemplate
export const t8 = `DROP DATABASE IF EXISTS ${name} SYNC`; // expect: untaggedTemplate
export const t9 = `EXCHANGE TABLES ${table} AND ${name}`; // expect: untaggedTemplate
export const t10 = `RENAME TABLE ${table} TO ${name}`; // expect: untaggedTemplate
export const t11 = `TRUNCATE TABLE ${table}`; // expect: untaggedTemplate
export const t12 = `WITH x AS (SELECT 1) SELECT * FROM x`; // expect: untaggedTemplate
export const t13 = `GRANT SELECT ON ${table} TO ${name}`; // expect: untaggedTemplate
export const t14 = `OPTIMIZE TABLE ${table} FINAL`; // expect: untaggedTemplate
export const t15 = `SYSTEM FLUSH LOGS`; // expect: untaggedTemplate
export const t16 = `${name} AS t LEFT ANTI JOIN linked AS l ON l.id = t.id`; // expect: untaggedTemplate
export const t17 = `has({chains:Array(Int64)}, toInt64(${name}))`; // expect: untaggedTemplate
export const t18 = `chain_id = :'chain'`; // expect: untaggedTemplate
export const t19 = ` WHERE id = ${name}`; // expect: untaggedTemplate
export const t20 = `prices AS (SELECT 1)`; // expect: untaggedTemplate
export const t21 = `${where}SELECT count() AS n FROM t`; // expect: untaggedTemplate
export const t22 = gql`SELECT * FROM t`; // expect: untaggedTemplate
// expect-next-line: untaggedTemplate
export const t23 = `
    -- the last row
    select * from t`;
export const t25 = `${name} AND ${where}`; // expect: untaggedTemplate
export const t24 = `CREATE USER IF NOT EXISTS ${name} IDENTIFIED WITH sha256_hash BY {hash:String}`; // expect: untaggedTemplate

// String literals that are statements.
export const s1 = 'SELECT name FROM system.databases ORDER BY name'; // expect: untaggedString
export const s2 = 'SYSTEM FLUSH LOGS'; // expect: untaggedString
export const s3 = 'DROP TABLE t'; // expect: untaggedString

// 2. Concatenation.
export const c1 = 'SELECT * FROM t WHERE id = ' + name; // expect: concatenation
export const c2 = name + ' WHERE ' + where; // expect: concatenation
export const c3 = 'SELECT 1'.concat(' FROM t'); // expect: concatenation
export const c4 = ['SELECT *', 'FROM t'].join(' '); // expect: concatenation
export const c5 = conditions.join(' AND '); // expect: concatenation
export const c6 = (`SELECT * FROM ${table}` + ' LIMIT 1') satisfies string; // expect: concatenation
export const c7 = name.concat(' ORDER BY id'); // expect: concatenation

// 3. String building inside an allowed tag.
export const i1 = sql`SELECT * FROM t WHERE ${`x = ${name}`}`; // expect: stringInTag
export const i2 = sql`SELECT * FROM t WHERE ${name + where}`; // expect: stringInTag
export const i3 = sql`SELECT ${conditions.join(', ')} FROM t`; // expect: stringInTag
export const i4 = sql`SELECT * FROM t WHERE ${(name + ' = 1') satisfies string}`; // expect: stringInTag
export const i5 = sql`SELECT * FROM t WHERE ${name.concat(where)}`; // expect: stringInTag

// raw() with string building.
export const r1 = raw(`x = ${name}`); // expect: stringInRaw
export const r2 = raw('x = ' + name); // expect: stringInRaw
