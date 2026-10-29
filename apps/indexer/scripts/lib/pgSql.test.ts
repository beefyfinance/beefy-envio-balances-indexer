import { describe, expect, it } from 'vitest';

import { type PgSql, pgBigint, pgIdent, pgJoin, pgQualified, pgRaw, pgSql, pgValue } from './pgSql.ts';

/** What an attacker would put in a name or a value. */
const HOSTILE = ["a'b", 'a"b', 'a;b', 'a b', 'a\\b', 'a.b', '', "x'); drop table t; --", ":'v_0'", 'tablé'];

describe('pgSql tag', () => {
    it('keeps values out of the text: each is a psql variable', () => {
        for (const value of HOSTILE) {
            const statement = pgSql`select * from t where a = ${pgValue(value)} limit ${pgBigint(5)}`;
            expect(statement.text).toBe(`select * from t where a = :'v_0' limit :'v_1'::bigint`);
            expect(statement.vars).toEqual({ v_0: value, v_1: '5' });
        }
        expect(pgSql`${pgValue(123n)}`.vars).toEqual({ v_0: '123' });
    });

    it('refuses values psql would misread', () => {
        for (const value of ['a\nb', 'a\r', 'a\0']) expect(() => pgValue(value)).toThrow('invalid value');
        expect(() => pgValue(Number.NaN)).toThrow('not finite');
        expect(() => pgBigint(1.5)).toThrow('invalid bigint');
    });

    it('merges nested fragments, renumbering their variables', () => {
        const inner = pgSql`chain_id = ${pgValue(1)} and block_number <= ${pgValue(2n)}`;
        const outer = pgSql`with x as (select 1 from t where ${inner}) select ${pgValue('y')} where ${inner}`;
        expect(outer.text).toBe(
            `with x as (select 1 from t where chain_id = :'v_0' and block_number <= :'v_1') select :'v_2' where chain_id = :'v_3' and block_number <= :'v_4'`
        );
        expect(outer.vars).toEqual({ v_0: '1', v_1: '2', v_2: 'y', v_3: '1', v_4: '2' });
        expect(inner.vars).toEqual({ v_0: '1', v_1: '2' });
        expect(Object.isFrozen(outer) && Object.isFrozen(outer.vars)).toBe(true);
    });

    it('joins fragments', () => {
        const joined = pgJoin([pgSql`a = ${pgValue('x')}`, pgSql`b = ${pgValue('y')}`], pgSql` and `);
        expect(joined.text).toBe(`a = :'v_0' and b = :'v_1'`);
        expect(pgJoin([pgIdent('a'), pgRaw('b')]).text).toBe('"a", b');
        expect(pgJoin([]).text).toBe('');
    });

    it('quotes plain names and refuses anything else', () => {
        expect(pgSql`select ${pgIdent('token')} from ${pgQualified('raw_megaeth', 'Balance')}`.text).toBe(
            'select "token" from "raw_megaeth"."Balance"'
        );
        for (const name of [...HOSTILE, '1table', 'a'.repeat(64), 'x\u0000']) {
            expect(() => pgIdent(name)).toThrow('invalid Postgres identifier');
            expect(() => pgQualified('public', name)).toThrow('invalid Postgres identifier');
            expect(() => pgQualified(name, 'Balance')).toThrow('invalid Postgres identifier');
        }
        expect(pgIdent('a'.repeat(63))).toBeDefined();
    });

    it('refuses anything but a fragment, in TypeScript and at run time', () => {
        const name = 'x';
        const count = 1;
        const keyword: string = 'desc';
        // @ts-expect-error a plain string is not SQL
        expect(() => pgSql`select ${name}`).toThrow('not a SQL fragment');
        // @ts-expect-error nor is a number
        expect(() => pgSql`limit ${count}`).toThrow('not a SQL fragment');
        // @ts-expect-error nor an object that looks like one
        expect(() => pgSql`select ${{ text: name, vars: {} }}`).toThrow('not a SQL fragment');
        // @ts-expect-error pgRaw takes a string literal type only
        pgRaw(keyword);
        const statement: PgSql = pgSql`select 1`;
        expect(() => {
            // @ts-expect-error a statement is read only
            statement.text = 'drop table t'; // oxlint-disable-line beefy/no-untagged-sql -- a hostile assignment the test expects to fail
        }).toThrow('read only');
        expect(statement.text).toBe('select 1');
    });
});
