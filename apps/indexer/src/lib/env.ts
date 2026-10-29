/**
 * Environment parsing shared by the indexer configuration (src/lib/config.ts) and the scripts' one
 * (scripts/lib/config.ts): one zod schema per variable, and `parseEnv`, which reports every problem at once.
 *
 * Reads nothing by itself (the config modules pass `process.env`), and has no relative imports: the scripts import
 * it directly under node's type stripping.
 */
import { z } from 'zod';

export type Env = Readonly<Record<string, string | undefined>>;

/** Every invalid or missing variable, so a misconfigured deploy is fixed in one round. Values are never printed. */
export class ConfigError extends Error {
    readonly problems: readonly string[];

    constructor(problems: readonly string[]) {
        super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
        this.name = 'ConfigError';
        this.problems = problems;
    }
}

/** Unset and blank (`FOO=`) both mean "not set"; surrounding spaces are ignored. */
const trimmed = (value: unknown) => {
    if (typeof value !== 'string') return value;
    const text = value.trim();
    return text === '' ? undefined : text;
};

/** An integer in [min, max] written in decimal digits (no hex, exponent or fraction), `fallback` when unset. */
export const intVar = (fallback: number, { min, max }: { min: number; max: number }) => {
    const message = `must be an integer between ${min} and ${max}`;
    return z
        .preprocess(
            trimmed,
            z
                .string(message)
                .regex(/^-?\d{1,15}$/, message)
                .transform(Number)
                .pipe(z.number().int().min(min, message).max(max, message))
                .optional()
        )
        .transform((value) => value ?? fallback);
};

/** One of `values`, `fallback` when unset. */
export const enumVar = <const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
    z.preprocess(trimmed, z.enum(values).default(fallback));

/** An http(s) URL without whitespace (an unstripped `# comment` after a value is a mistake, not a path). */
const httpUrl = () =>
    z
        .url({
            protocol: /^https?$/,
            error: (issue) => (issue.input === undefined ? 'is required' : 'must be an http(s) URL'),
        })
        .refine((value) => !/\s/.test(value), 'must be an http(s) URL');

/** An http(s) URL, `fallback` when unset. */
export const urlVar = (fallback: string) => z.preprocess(trimmed, httpUrl().default(fallback));

/** An http(s) URL that must be set. */
export const requiredUrlVar = () => z.preprocess(trimmed, httpUrl());

/** An http(s) URL, undefined when unset. */
export const optionalUrlVar = () => z.preprocess(trimmed, httpUrl().optional());

/** Free text (a user name, a password: kept as written, not trimmed), `fallback` when unset or empty. */
export const stringVar = (fallback: string) =>
    z.preprocess((value) => (value === '' ? undefined : value), z.string().default(fallback));

/** A host name, an address or a socket directory: letters, digits, `.`, `_`, `:`, `/` and `-` (not first) only. */
export const hostVar = (fallback: string) =>
    z.preprocess(
        trimmed,
        z
            .string()
            .regex(/^[A-Za-z0-9._:/][A-Za-z0-9._:/-]*$/, 'must be a host name, an address or a socket directory')
            .default(fallback)
    );

/** A SQL identifier (a schema or database name), `fallback` when unset. */
export const identifierVar = (fallback: string) =>
    z.preprocess(
        trimmed,
        z
            .string()
            .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a SQL identifier ([A-Za-z_][A-Za-z0-9_]*)')
            .default(fallback)
    );

/**
 * Parses `env` with `schema` (an object keyed by variable name: issues name the variable, never its value) and
 * throws a {@link ConfigError} listing every problem.
 */
export const parseEnv = <S extends z.ZodType>(schema: S, env: Env): z.output<S> => {
    const parsed = schema.safeParse(env);
    if (parsed.success) return parsed.data;
    throw new ConfigError(
        parsed.error.issues.map((issue) => {
            const name = issue.path.map(String).join('.');
            return name === '' ? issue.message : `${name}: ${issue.message}`;
        })
    );
};
