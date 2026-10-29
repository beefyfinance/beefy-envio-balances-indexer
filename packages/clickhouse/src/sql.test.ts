import { createHash } from 'node:crypto';

import * as R from 'remeda';
import { describe, expect, it } from 'vitest';

import { accessStatements } from './access.ts';
import { createClickhouseClient } from './client.ts';
import { deploy, registerDeploymentStatement } from './deployments.ts';
import {
    type Sql,
    definerClause,
    envioDatabaseOf,
    envioDatabaseVersion,
    ident,
    int,
    join,
    param,
    qualified,
    qualifiedName,
    raw,
    sql,
    utcTime,
    versionNumber,
} from './sql.ts';
import { apiViews, eventPriceTable } from './timeline.ts';

/** What an attacker would put in a name, a time or a number. */
const HOSTILE = ["a'b", 'a`b', 'a;b', 'a{b}', 'a\nb', 'a b', 'a\\b', 'a.b', '', 'a"b', 'a)b', 'a--b', 'a/*b', 'a\0b'];

describe('sql tag', () => {
    it('keeps values out of the text: each is a typed placeholder, its value a parameter', () => {
        for (const value of [...HOSTILE, "x'); DROP TABLE t; --", '{p_0:String}', '`x`']) {
            const statement = sql`SELECT ${param('String', value)} AS s, ${param('Array(String)', [value])} AS a`;
            expect(statement.text).toBe('SELECT {p_0:String} AS s, {p_1:Array(String)} AS a');
            expect(statement.params).toEqual({ p_0: value, p_1: [value] });
        }
    });

    it('spells the ClickHouse type out and checks the value against it', () => {
        const statement = sql`${param('UInt32', 7)} ${param('Int64', 2n ** 62n)} ${param("DateTime64(3, 'UTC')", '2024-01-01')} ${param(
            'Map(Int32, UInt64)',
            new Map([[8453, 12n]])
        )}`;
        expect(statement.text).toBe("{p_0:UInt32} {p_1:Int64} {p_2:DateTime64(3, 'UTC')} {p_3:Map(Int32, UInt64)}");
        expect(statement.params).toEqual({
            p_0: 7,
            p_1: 2n ** 62n,
            p_2: '2024-01-01 00:00:00.000',
            p_3: new Map([[8453, 12n]]),
        });
        expect(param("DateTime64(6, 'UTC')", '2024-01-01 10:00:00.123456')).toBeDefined();
        expect(() => param('UInt32', -1)).toThrow('invalid UInt32');
        expect(() => param('UInt32', 1.5)).toThrow('invalid UInt32');
        expect(() => param('UInt8', 256)).toThrow('invalid UInt8');
        expect(() => param('Float64', Number.NaN)).toThrow('invalid Float64');
        expect(() => param("DateTime64(3, 'UTC')", "2024-01-01'; DROP")).toThrow('time must be');
        expect(() => param("DateTime64(6, 'UTC')", '2024-02-30 00:00:00')).toThrow('time must be');
        expect(() => param('Array(Int64)', [1, 'x' as unknown as number])).toThrow('invalid Int64');
        expect(() => param('Map(Int32, UInt64)', new Map([[1, -1]]))).toThrow('invalid UInt64');
        expect(() => param('String', 1 as unknown as string)).toThrow('invalid String');
        expect(() => param('Nullable(String)' as unknown as 'String', 'x')).toThrow('unsupported parameter type');
    });

    it('merges nested fragments, renumbering their placeholders so none collide', () => {
        const inner = sql`a = ${param('String', 'x')} AND b = ${param('UInt32', 1)}`;
        const outer = sql`SELECT ${param('String', 'y')} WHERE ${inner} OR (${inner}) LIMIT ${param('UInt32', 2)}`;
        expect(inner.text).toBe('a = {p_0:String} AND b = {p_1:UInt32}');
        expect(outer.text).toBe(
            'SELECT {p_0:String} WHERE a = {p_1:String} AND b = {p_2:UInt32} OR (a = {p_3:String} AND b = {p_4:UInt32}) LIMIT {p_5:UInt32}'
        );
        expect(outer.params).toEqual({ p_0: 'y', p_1: 'x', p_2: 1, p_3: 'x', p_4: 1, p_5: 2 });
        // the inner fragment is unchanged
        expect(inner.params).toEqual({ p_0: 'x', p_1: 1 });
        expect(Object.isFrozen(outer) && Object.isFrozen(outer.params)).toBe(true);
    });

    it('joins fragments', () => {
        const columns = join([ident('a'), sql`${param('String', 'v')} AS b`, raw('c')]);
        expect(columns.text).toBe('`a`, {p_0:String} AS b, c');
        expect(join([sql`x = ${param('UInt8', 1)}`, sql`y = ${param('UInt8', 2)}`], sql` AND `).text).toBe(
            'x = {p_0:UInt8} AND y = {p_1:UInt8}'
        );
        expect(join([]).text).toBe('');
    });

    it('inlines checked integers and literals of our own code', () => {
        expect(sql`LIMIT ${int(10)} OFFSET ${int(-3)} ${int(2n ** 70n)}`.text).toBe(
            'LIMIT 10 OFFSET -3 1180591620717411303424'
        );
        for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60])
            expect(() => int(value)).toThrow('invalid integer');
        expect(sql`x = ${raw("'PENDING'")}`.text).toBe("x = 'PENDING'");
    });

    it('refuses anything but a fragment, in TypeScript and at run time', () => {
        const name = 'x';
        const count = 1;
        const flag: string = 'PENDING';
        // @ts-expect-error a plain string is not SQL
        expect(() => sql`SELECT ${name}`).toThrow('not a SQL fragment');
        // @ts-expect-error nor is a number
        expect(() => sql`LIMIT ${count}`).toThrow('not a SQL fragment');
        // @ts-expect-error nor a template literal
        expect(() => sql`SELECT ${`${name}`}`).toThrow('not a SQL fragment'); // oxlint-disable-line beefy/no-untagged-sql, typescript/no-unnecessary-template-expression -- the nested template is what this test checks the tag refuses
        // @ts-expect-error nor an object that looks like one
        expect(() => sql`SELECT ${{ text: name, params: {} }}`).toThrow('not a SQL fragment');
        // @ts-expect-error raw takes a string literal type only
        expect(raw(flag)).toBeDefined();
        // @ts-expect-error a parameter's value has the JS type of its ClickHouse type
        expect(() => param('UInt32', '1')).toThrow('invalid UInt32');
        // @ts-expect-error and the ClickHouse type is one of a fixed set
        expect(() => param('Nullable(String)', 'x')).toThrow('unsupported parameter type');
        const statement: Sql = sql`SELECT 1`;
        expect(() => {
            // @ts-expect-error a statement is read only
            statement.text = 'DROP TABLE t'; // oxlint-disable-line beefy/no-untagged-sql -- the hostile overwrite this test checks is refused
        }).toThrow('read only');
        expect(statement.text).toBe('SELECT 1');
    });
});

describe('identifier', () => {
    it('quotes plain names and refuses anything else', () => {
        expect(ident('beefy_raw').text).toBe('`beefy_raw`');
        expect(qualified('a', 'b_1').text).toBe('`a`.`b_1`');
        expect(qualifiedName('analytics.token').text).toBe('`analytics`.`token`');
        expect(sql`SELECT * FROM ${qualified('a', 'b')}`.text).toBe('SELECT * FROM `a`.`b`');
        for (const name of HOSTILE) {
            expect(() => ident(name)).toThrow('invalid ClickHouse identifier');
            expect(() => qualified('a', name)).toThrow('invalid ClickHouse identifier');
            expect(() => qualifiedName(`a.${name}`)).toThrow(/invalid ClickHouse identifier|expected database.table/);
        }
        expect(() => ident('1abc')).toThrow('invalid ClickHouse identifier');
        expect(() => ident('a'.repeat(300))).toThrow('invalid ClickHouse identifier');
        expect(() => definerClause({ definer: 'x` SQL SECURITY NONE' })).toThrow('invalid ClickHouse identifier');
    });
});

describe('checked values', () => {
    it('accept versions as integers only', () => {
        expect(versionNumber('3')).toBe(3);
        expect(versionNumber(1_000_000)).toBe(1_000_000);
        for (const value of [...HOSTILE, '3; DROP', '0', '-1', '1e3', '0x10', '1.5', ' 3', '3 ', '1000001']) {
            expect(() => versionNumber(value)).toThrow('version must be');
        }
        for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
            expect(() => versionNumber(value)).toThrow('version must be');
        expect(() => eventPriceTable(Number.NaN)).toThrow('version must be');
    });

    it('accept real UTC times only, normalised', () => {
        expect(utcTime('2024-01-01')).toBe('2024-01-01 00:00:00.000');
        expect(utcTime('2024-01-01 10:00:00.123456')).toBe('2024-01-01 10:00:00.123');
        expect(utcTime('2024-01-01T10:00:00Z')).toBe('2024-01-01 10:00:00.000');
        for (const value of [
            ...HOSTILE,
            "2024-01-01'; DROP",
            '2024-02-30',
            '2024-13-01',
            '2024-01-01 25:00:00',
            'now()',
            '1704067200',
            '2024-01-01\n',
        ]) {
            expect(() => utcTime(value)).toThrow('time must be');
        }
    });

    it('name Envio databases <prefix><N> only', () => {
        const schema = { envioDatabasePrefix: 'envio_dev_' };
        expect(envioDatabaseOf(schema, 4)).toBe('envio_dev_4');
        expect(envioDatabaseVersion(schema, 'envio_dev_4')).toBe(4);
        for (const name of ['envio_dev_04', 'envio_dev_', 'envio_dev_4x', 'envio_prod_4', 'default', 'envio_dev_4;']) {
            expect(envioDatabaseVersion(schema, name)).toBeUndefined();
        }
        for (const prefix of HOSTILE)
            expect(() => envioDatabaseOf({ envioDatabasePrefix: prefix }, 1)).toThrow('invalid Envio database prefix');
    });
});

describe('statement builders', () => {
    const schema = {
        database: 'ours',
        prices: { price5m: 'px.asset_price_5m', token: 'px.token' },
        watermarkPriceSources: ['api'],
        envioDatabasePrefix: 'envio_',
    };

    it('refuse a hostile name wherever one is used', () => {
        for (const name of HOSTILE) {
            expect(() =>
                apiViews({ ...schema, database: name }, { version: 1, envioDatabase: 'envio_1' })[0]?.create('x')
            ).toThrow('invalid ClickHouse identifier');
            expect(() => apiViews(schema, { version: 1, envioDatabase: name })[0]?.create('x')).toThrow(
                'invalid ClickHouse identifier'
            );
            expect(() => registerDeploymentStatement(schema, 1, name)).toThrow('invalid ClickHouse identifier');
            expect(() =>
                accessStatements(schema, {
                    pipelineUser: name,
                    pipelinePassword: 'p'.repeat(16),
                    apiPassword: 'a'.repeat(16),
                    envioDatabasePrefix: 'envio_',
                })
            ).toThrow('invalid ClickHouse identifier');
        }
    });

    it('send a hostile password as the parameter of its hash, never in the text', () => {
        const password = "x'; DROP USER default; --{a}`\n";
        const statements = accessStatements(schema, {
            pipelinePassword: password,
            apiPassword: password,
            envioDatabasePrefix: 'envio_',
        });
        for (const { text, params } of statements) {
            expect(text).not.toContain('DROP USER default');
            for (const value of R.values(params)) expect(value).toMatch(/^[0-9a-f]{32}$|^[0-9a-f]{64}$/);
        }
        // each user: SHA-256 of the password and its own random salt, as `sha256_hash ... SALT` wants
        const users = statements.filter(({ text }) => text.includes('sha256_hash'));
        expect(users).toHaveLength(2);
        const salted = users.map(({ params }) => {
            const [hash, salt] = R.values(params) as string[];
            expect(hash).toBe(
                createHash('sha256')
                    .update(password + salt, 'utf8')
                    .digest('hex')
            );
            return salt;
        });
        expect(salted[0]).not.toBe(salted[1]);
        expect(() =>
            accessStatements(schema, {
                pipelinePassword: 'short',
                apiPassword: password,
                envioDatabasePrefix: 'envio_',
            })
        ).toThrow('at least 16');
    });

    it('refuse to deploy on a hostile database before touching ClickHouse', async () => {
        // nothing listens there: a request would fail with a connection error, not this one
        const client = createClickhouseClient({ url: 'http://localhost:0', username: 'u', password: '' });
        for (const name of HOSTILE)
            await expect(deploy(client, schema, 1, name)).rejects.toThrow('invalid ClickHouse identifier');
    });
});

describe('client', () => {
    it('refuses a hostile table name before sending anything', async () => {
        const client = createClickhouseClient({ url: 'http://localhost:0', username: 'u', password: '' });
        await expect(async () => client.insert(qualified('db', 't`; DROP'), [{ a: 1 }])).rejects.toThrow(
            'invalid ClickHouse identifier'
        );
        await expect(async () => client.insert(qualified('db;', 't'), [{ a: 1 }])).rejects.toThrow(
            'invalid ClickHouse identifier'
        );
        // @ts-expect-error a table is an identifier, never a string
        await expect(client.insert('`db`.`t`', [{ a: 1 }])).rejects.toThrow('not an identifier');
        // @ts-expect-error a statement is a Sql value, never a string
        await expect(client.query('SELECT 1')).rejects.toThrow('not a SQL statement'); // oxlint-disable-line beefy/no-untagged-sql -- the untagged string this test checks the client refuses
        await client.close();
    });
});
