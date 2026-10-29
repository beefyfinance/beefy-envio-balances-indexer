import * as R from 'remeda';

export type Env = Readonly<Record<string, string | undefined>>;

/** Thrown with every problem at once, so a misconfigured deploy is fixed in one round. */
export class ConfigError extends Error {
    constructor(readonly problems: readonly string[]) {
        super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
        this.name = 'ConfigError';
    }
}

type Reader<T> = (env: Env, problems: string[]) => T;

const present = (env: Env, name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
};

export const requiredString =
    (name: string): Reader<string> =>
    (env, problems) => {
        const value = present(env, name);
        if (value === undefined) problems.push(`${name} is required`);
        return value ?? '';
    };

export const optionalString =
    (name: string, fallback: string): Reader<string> =>
    (env) =>
        present(env, name) ?? fallback;

export const requiredUrl =
    (name: string, protocols: readonly string[]): Reader<string> =>
    (env, problems) => {
        const value = present(env, name);
        if (value === undefined) {
            problems.push(`${name} is required`);
            return '';
        }
        try {
            if (!protocols.includes(new URL(value).protocol))
                problems.push(`${name} must use ${protocols.join(' or ')}`);
        } catch {
            problems.push(`${name} must be a URL`);
        }
        return value;
    };

export const integer =
    (name: string, fallback: number, { min, max }: { min: number; max: number }): Reader<number> =>
    (env, problems) => {
        const raw = present(env, name);
        if (raw === undefined) return fallback;
        const value = /^-?\d{1,16}$/.test(raw) ? Number(raw) : Number.NaN;
        if (!Number.isInteger(value) || value < min || value > max) {
            problems.push(`${name} must be an integer between ${min} and ${max}`);
            return fallback;
        }
        return value;
    };

export const oneOf =
    <const T extends string>(name: string, allowed: readonly T[], fallback: T): Reader<T> =>
    (env, problems) => {
        const raw = present(env, name);
        if (raw === undefined) return fallback;
        if (!(allowed as readonly string[]).includes(raw)) {
            problems.push(`${name} must be one of ${allowed.join(', ')}`);
            return fallback;
        }
        return raw as T;
    };

/** A comma separated list whose every item must be in `allowed`; unset means `fallback`. Duplicates are dropped. */
export const listOf =
    <const T extends string>(name: string, allowed: readonly T[], fallback: readonly T[]): Reader<T[]> =>
    (env, problems) => {
        const raw = present(env, name);
        if (raw === undefined) return [...fallback];
        const items = [
            ...new Set(
                raw
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
            ),
        ];
        const unknown = items.filter((item) => !(allowed as readonly string[]).includes(item));
        if (unknown.length > 0) {
            problems.push(`${name} has unknown values ${unknown.join(', ')} (allowed: ${allowed.join(', ')})`);
            return [...fallback];
        }
        return items as T[];
    };

type Shape = Record<string, Reader<unknown>>;
type Parsed<S extends Shape> = { [K in keyof S]: ReturnType<S[K]> };

/** A reader for a group of fields; groups nest, and every problem of every group is reported together. */
export const group =
    <S extends Shape>(
        shape: S,
        extraChecks: (value: Parsed<S>, problems: string[]) => void = () => {}
    ): Reader<Parsed<S>> =>
    (env, problems) => {
        const value = R.mapValues(shape, (read) => read(env, problems)) as Parsed<S>;
        extraChecks(value, problems);
        return value;
    };

/** Reads every field of `shape`, collecting all problems, and throws a single {@link ConfigError} if any. */
export const parseEnv = <S extends Shape>(
    env: Env,
    shape: S,
    extraChecks?: (value: Parsed<S>, problems: string[]) => void
): Parsed<S> => {
    const problems: string[] = [];
    const value = group(shape, extraChecks)(env, problems);
    if (problems.length > 0) throw new ConfigError(problems);
    return value;
};

/**
 * A URL as scheme and host only, for a log line: credentials, path and query never reach one (RPC providers put their
 * key in the path or the query).
 */
export const redact = (value: string): string => {
    try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}`;
    } catch {
        return '***';
    }
};
