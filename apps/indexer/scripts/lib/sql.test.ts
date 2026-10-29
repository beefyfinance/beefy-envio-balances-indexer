import { param, sql } from '@beefy/clickhouse';
import { describe, expect, it } from 'vitest';

import { encodeParam, paramEntries } from './sql.ts';

describe('ClickHouse parameter encoding', () => {
    it("encodes parameter values in ClickHouse's text format", () => {
        expect(encodeParam('plain')).toBe('plain');
        expect(encodeParam('tab\there\nnew\\line')).toBe('tab\\there\\nnew\\\\line');
        expect(encodeParam(42)).toBe('42');
        expect(encodeParam(2n ** 70n)).toBe('1180591620717411303424');
        expect(encodeParam([8453, 10])).toBe('[8453,10]');
        expect(encodeParam(["it's", 'back\\slash', "'];DROP TABLE x;--"])).toBe(
            "['it\\'s','back\\\\slash','\\'];DROP TABLE x;--']"
        );
        expect(encodeParam(new Map([[8453, 12n]]))).toBe('{8453:12}');
        expect(encodeParam(new Map([["k'", 'v\n']]))).toBe("{'k\\'':'v\\n'}");
        expect(() => encodeParam(Number.NaN)).toThrow('not finite');
    });

    it('names parameters strictly', () => {
        expect(paramEntries({ chains: [1], name: 'x' })).toEqual([
            ['param_chains', '[1]'],
            ['param_name', 'x'],
        ]);
        expect(() => paramEntries({ 'a&param_b': 1 })).toThrow('invalid query parameter name');
        expect(() => paramEntries({ 'a b': 1 })).toThrow('invalid query parameter name');
    });

    it("sends a statement's values as its parameters", () => {
        const statement = sql`SELECT id FROM t WHERE has(${param('Array(Int64)', [8453])}, chain_id) AND id = ${param('String', "x'; DROP TABLE t")}`;
        expect(paramEntries(statement.params)).toEqual([
            ['param_p_0', '[8453]'],
            ['param_p_1', "x'; DROP TABLE t"],
        ]);
        expect(statement.text).not.toContain('DROP');
    });
});
