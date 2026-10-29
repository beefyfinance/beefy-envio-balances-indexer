// Code `beefy/no-untagged-sql` accepts: no line here may be reported (see ../rule.test.js).
declare const sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
declare const pgSql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
declare const ident: (name: string) => unknown;
declare const raw: (text: string) => unknown;
declare const param: { string: (value: string) => unknown };
declare const db: { sql: typeof sql };
declare const table: string;
declare const parts: unknown[];
declare const name: string;
declare const count: number;
declare const expectText: (value: unknown) => { toContain: (text: string) => void; toBe: (text: string) => void };

// Tagged SQL, with fragments, helpers and nested tags as expressions.
export const a = sql`SELECT * FROM ${ident(table)} WHERE id = ${param.string(name)}`;
export const b = sql`
    WITH x AS (SELECT 1)
    SELECT * FROM x ${count > 0 ? sql`LIMIT ${count}` : sql``}`;
export const c = pgSql`select token from ${ident(table)} where chain_id = ${param.string(name)}`;
export const d = db.sql`INSERT INTO ${ident(table)} VALUES (1)`;
export const e = sql`SELECT ${`static`} FROM t`;
export const f = raw('FINAL');

// Prose that mentions SQL words.
export const m1 = `Select a chain from the list: ${name}`;
export const m2 = 'select one of the options from below';
export const m3 = `Unable to insert ${count} rows into the queue`;
export const m4 = `Created table ${table} in ${count} ms`;
export const m5 = 'Drop the table if you must';
export const m6 = `With ${count} retries left`;
export const m7 = 'Grant access to the user';
export const m8 = `system ${name} restarted`;
export const m9 = 'Update the settings, then truncate the log';
export const m10 = `order by ${name}, group by ${count}`;
export const m11 = 'WHERE';
export const m12 = `${name} and ${count}`;
export const m13 = 'and or where from select';
export const m14 = ['a', 'b'].join(', ');
export const m15 = 'prefix ' + name + ' suffix';
export const m16 = `Delete from cache: ${name}`;
export const m17 = 'LIMIT 1 BY event_id';

// Injection payloads in test data: not a statement start.
export const p1 = "0x1'; DROP TABLE Contract; --";
export const p2 = 'Contract; DROP TABLE Token';

// Text looked for in SQL, not SQL being built.
expectText(a).toContain('SELECT * FROM t WHERE id = 1');
expectText(a).toBe(`CREATE TABLE ${table} (x UInt8) ENGINE = Memory`);
export const found = String(a).includes('SELECT id FROM t');

// Arithmetic and lookups inside a tag that are not string building.
export const g = sql`SELECT ${parts} FROM t`;
export const h = sql`SELECT ${ident(`${name}_next`)} FROM t`;
