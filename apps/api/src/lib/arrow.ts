import {
    type DataType,
    type Table,
    Dictionary,
    FixedSizeBinary,
    Int,
    tableFromIPC,
    Timestamp,
    TimeUnit,
    Type,
    type Vector,
} from 'apache-arrow';
import * as R from 'remeda';

/**
 * Decoding of ClickHouse's `ArrowStream` results: ClickHouse writes its columns as they are (no text to format), the
 * API turns them into the plain values its JSON responses carry. What each ClickHouse type arrives as:
 *
 * | ClickHouse | Arrow | here |
 * |---|---|---|
 * | String, LowCardinality(String) | Utf8 (Binary on older servers, a Dictionary when asked) | `string` |
 * | UInt8 to UInt32, Int8 to Int32, Float64 | the same | `number` |
 * | UInt64, Int64 | Uint64, Int64 (bigint) | `bigint-string`: decimal string, as JSON gave 64-bit integers |
 * | any integer that must fit a number | Int, any width | `integer`: a number (a 64-bit one must be a safe integer) |
 * | Int256, UInt256 | FixedSizeBinary(32), little endian, two's complement for Int256 | `int256-string`, `uint256-string` |
 * | DateTime64(3) | Timestamp(ms) | `ms-string`: milliseconds since the epoch, as a string |
 * | DateTime | Uint32 (seconds) | `number` |
 * | Nullable(T) | T with a validity bitmap | `null` where null |
 * | Enum8 | Int8: the names are lost | not accepted: select `toString(column)` |
 *
 * Every column a query reads is declared with its kind; a missing column or an unexpected Arrow type throws, so a view
 * that changes shape fails loudly instead of serving wrong values.
 *
 * Buffers must come uncompressed: ClickHouse compresses Arrow with LZ4 unless `output_format_arrow_compression_method`
 * is `none`, which the API user's settings profile sets (`access`). A compressed body is refused with an error naming the
 * setting (no codec is registered here), rather than decompressed.
 */
export type ColumnKind =
    | 'string'
    | 'number'
    | 'integer'
    | 'bigint-string'
    | 'int256-string'
    | 'uint256-string'
    | 'ms-string';

/** A row type's columns and how to decode each; `nullable` columns give `null` where ClickHouse has NULL. */
export type ColumnSpec<Row> = { [K in keyof Row & string]: { kind: ColumnKind; nullable?: boolean } };

const utf8 = new TextDecoder('utf-8', { fatal: true });

const WORD = 64n;
const TWO_256 = 1n << 256n;
const SIGN_256 = 1n << 255n;

/** A 256-bit little endian integer. */
const int256 = (bytes: Uint8Array, signed: boolean): bigint => {
    if (bytes.length !== 32) throw new Error(`expected 32 bytes for a 256-bit integer, got ${bytes.length}`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, 32);
    const value =
        (view.getBigUint64(24, true) << (3n * WORD)) |
        (view.getBigUint64(16, true) << (2n * WORD)) |
        (view.getBigUint64(8, true) << WORD) |
        view.getBigUint64(0, true);
    return signed && value >= SIGN_256 ? value - TWO_256 : value;
};

/** The Arrow type a column must have for its kind, the value type of a dictionary when it is one. */
const valueType = (type: DataType): DataType => (type instanceof Dictionary ? (type.dictionary as DataType) : type);

const isWide = (type: DataType): boolean => type instanceof Int && type.bitWidth === 64;

const accepts = (kind: ColumnKind, type: DataType): boolean => {
    const value = valueType(type);
    switch (kind) {
        case 'string':
            return value.typeId === Type.Utf8 || value.typeId === Type.LargeUtf8 || value.typeId === Type.Binary;
        case 'number':
            return (value instanceof Int && !isWide(value)) || value.typeId === Type.Float;
        case 'integer':
            return value instanceof Int;
        case 'bigint-string':
            return isWide(value);
        case 'int256-string':
        case 'uint256-string':
            return value instanceof FixedSizeBinary && value.byteWidth === 32;
        case 'ms-string':
            return value instanceof Timestamp && value.unit === TimeUnit.MILLISECOND;
    }
};

/** The value of a non-null cell as its kind says. */
const convert = (kind: ColumnKind, value: unknown): unknown => {
    switch (kind) {
        case 'string':
            return value instanceof Uint8Array ? utf8.decode(value) : value;
        case 'number':
            return value;
        case 'integer': {
            if (typeof value !== 'bigint') return value;
            if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
                throw new Error(`integer ${value.toString()} does not fit a number`);
            }
            return Number(value);
        }
        case 'bigint-string':
            return (value as bigint).toString();
        case 'int256-string':
            return int256(value as Uint8Array, true).toString();
        case 'uint256-string':
            return int256(value as Uint8Array, false).toString();
        case 'ms-string':
            return (value as number).toString();
    }
};

/** The error of an Arrow body whose buffers are compressed: the API user's profile is not the one `access` creates. */
export class CompressedArrowError extends Error {
    constructor() {
        super(
            "ClickHouse returned compressed Arrow buffers: set output_format_arrow_compression_method = 'none' in the API user's settings profile (see the access command)"
        );
        this.name = 'CompressedArrowError';
    }
}

/** A result read whole, from bytes or from the response stream (a Node stream is an async iterable of chunks). */
const readTable = async (source: Uint8Array | AsyncIterable<Uint8Array>): Promise<Table> => {
    try {
        return source instanceof Uint8Array ? tableFromIPC(source) : await tableFromIPC(source);
    } catch (error) {
        // apache-arrow reads the batch header first and stops on its compression, for which no codec is registered
        if (error instanceof Error && /compressed but codec not found/.test(error.message))
            throw new CompressedArrowError();
        throw error;
    }
};

/**
 * The rows of an `ArrowStream` result (its bytes, or the HTTP response stream as the client gives it), each with the
 * columns of `spec` decoded as it says (other columns are ignored). An empty body (no result set at all) is no rows.
 */
export const decodeArrow = async <Row>(
    source: Uint8Array | AsyncIterable<Uint8Array>,
    spec: ColumnSpec<Row>
): Promise<Row[]> => {
    const table = await readTable(source);
    if (table.schema.fields.length === 0) return [];
    const columns = R.map(
        R.entries(spec as Record<string, { kind: ColumnKind; nullable?: boolean }>),
        ([name, { kind, nullable = false }]) => {
            const vector: Vector | null = table.getChild(name);
            if (vector === null) throw new Error(`ArrowStream result has no column ${name}`);
            if (!accepts(kind, vector.type))
                throw new Error(`column ${name}: ${String(vector.type)} cannot be read as ${kind}`);
            return { name, kind, nullable, vector };
        }
    );
    const rows: Row[] = [];
    for (let index = 0; index < table.numRows; index += 1) {
        const row: Record<string, unknown> = {};
        for (const { name, kind, nullable, vector } of columns) {
            const value: unknown = vector.get(index);
            if (value === null || value === undefined) {
                if (!nullable) throw new Error(`column ${name} has a NULL at row ${index}`);
                row[name] = null;
            } else {
                row[name] = convert(kind, value);
            }
        }
        rows.push(row as Row);
    }
    return rows;
};
