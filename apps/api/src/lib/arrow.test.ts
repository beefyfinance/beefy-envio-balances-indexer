import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CompressedArrowError, decodeArrow } from './arrow.ts';

/**
 * `arrow.fixture.arrows` is what ClickHouse 25.10 returned, with `output_format_arrow_compression_method = 'none'`, for:
 *
 * SELECT number AS n, toUInt64(18446744073709551615 - number) AS big,
 *   toInt256(number) - toInt256('57896044618658097711785492504343953926634992332820282019728792003956564819968') AS i256,
 *   toUInt256('115792089237316195423570985008687907853269984665640564039457584007913129639935') - number AS u256,
 *   if(number % 3 = 0, NULL, toDateTime('2024-01-01 00:00:00', 'UTC') + number) AS maybe_at,
 *   toDateTime64('2024-01-01 00:00:00.123', 3, 'UTC') + toIntervalMillisecond(number) AS at64,
 *   toLowCardinality(if(number % 2 = 0, 'VAULT', 'CLM_MANAGER')) AS lc, concat('é😀\'"', toString(number % 5)) AS s,
 *   toString(CAST(if(number % 2 = 0, 'BALANCE', 'MINT') AS Enum8('BALANCE' = 1, 'MINT' = 5))) AS kind, number / 7 AS f,
 *   toUInt8(number % 19) AS u8, if(number % 4 = 0, NULL, toNullable(concat('x', toString(number)))) AS ns
 * FROM numbers(24) FORMAT ArrowStream
 */
const fixture = new Uint8Array(readFileSync(new URL('./arrow.fixture.arrows', import.meta.url)));
/** `SELECT toUInt8(number) AS u8 FROM numbers(3) FORMAT ArrowStream` with ClickHouse's default LZ4 compression. */
const compressed = new Uint8Array(readFileSync(new URL('./arrow.lz4.fixture.arrows', import.meta.url)));

type Row = {
    n: string;
    big: string;
    i256: string;
    u256: string;
    maybe_at: number | null;
    at64: string;
    lc: string;
    s: string;
    kind: string;
    f: number;
    u8: number;
    ns: string | null;
};

const spec = {
    n: { kind: 'bigint-string' },
    big: { kind: 'bigint-string' },
    i256: { kind: 'int256-string' },
    u256: { kind: 'uint256-string' },
    maybe_at: { kind: 'number', nullable: true },
    at64: { kind: 'ms-string' },
    lc: { kind: 'string' },
    s: { kind: 'string' },
    kind: { kind: 'string' },
    f: { kind: 'number' },
    u8: { kind: 'number' },
    ns: { kind: 'string', nullable: true },
} as const;

const expected = (n: number): Row => ({
    n: String(n),
    big: (18446744073709551615n - BigInt(n)).toString(),
    i256: (BigInt(n) - 2n ** 255n).toString(),
    u256: (2n ** 256n - 1n - BigInt(n)).toString(),
    maybe_at: n % 3 === 0 ? null : 1_704_067_200 + n,
    at64: String(1_704_067_200_123 + n),
    lc: n % 2 === 0 ? 'VAULT' : 'CLM_MANAGER',
    s: `é😀'"${n % 5}`,
    kind: n % 2 === 0 ? 'BALANCE' : 'MINT',
    f: n / 7,
    u8: n % 19,
    ns: n % 4 === 0 ? null : `x${n}`,
});

describe('decodeArrow', () => {
    it('decodes every column type the API reads to the values JSON gave', async () => {
        const rows = await decodeArrow<Row>(fixture, spec);
        expect(rows).toEqual(Array.from({ length: 24 }, (_, n) => expected(n)));
    });

    it('refuses compressed buffers with an error naming the setting', async () => {
        await expect(decodeArrow(compressed, { u8: { kind: 'number' } })).rejects.toThrow(CompressedArrowError);
        await expect(decodeArrow(compressed, { u8: { kind: 'number' } })).rejects.toThrow(
            "output_format_arrow_compression_method = 'none'"
        );
    });

    it('reads only the declared columns, from bytes or from a stream of chunks', async () => {
        expect((await decodeArrow<{ u8: number }>(fixture, { u8: { kind: 'number' } }))[5]).toEqual({ u8: 5 });
        // a stream of chunks reads the same as the bytes
        const chunks = async function* () {
            for (let at = 0; at < fixture.length; at += 1000) yield fixture.subarray(at, at + 1000);
        };
        expect(await decodeArrow<Row>(chunks(), spec)).toEqual(await decodeArrow<Row>(fixture, spec));
    });

    it('refuses a missing column, a type that does not match its kind, and an unexpected NULL', async () => {
        await expect(decodeArrow(fixture, { nope: { kind: 'string' } })).rejects.toThrow('has no column nope');
        await expect(decodeArrow(fixture, { big: { kind: 'number' } })).rejects.toThrow('cannot be read as number');
        await expect(decodeArrow(fixture, { u8: { kind: 'string' } })).rejects.toThrow('cannot be read as string');
        await expect(decodeArrow(fixture, { lc: { kind: 'int256-string' } })).rejects.toThrow(
            'cannot be read as int256-string'
        );
        await expect(decodeArrow(fixture, { ns: { kind: 'string' } })).rejects.toThrow('has a NULL at row 0');
        await expect(decodeArrow(fixture, { big: { kind: 'integer' } })).rejects.toThrow('does not fit a number');
        expect(
            (
                await decodeArrow<{ u8: number; n: number }>(fixture, {
                    u8: { kind: 'integer' },
                    n: { kind: 'integer' },
                })
            )[3]
        ).toEqual({ u8: 3, n: 3 });
    });
});
