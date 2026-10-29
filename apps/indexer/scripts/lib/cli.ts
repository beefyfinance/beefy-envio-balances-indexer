/**
 * Argument parsers for the scripts' commander CLIs: each validates one option value and throws commander's
 * InvalidArgumentError (commander prints it with the usage and exits 1).
 */
import { type Command, InvalidArgumentError } from 'commander';
import * as R from 'remeda';

const DIGITS = /^\d+$/;

/** An integer in [min, max], written in decimal digits only (no sign, exponent or spaces). */
export const integerArg =
    ({ min, max }: { min: number; max: number }) =>
    (value: string): number => {
        const number = DIGITS.test(value) ? Number(value) : Number.NaN;
        if (!Number.isSafeInteger(number) || number < min || number > max) {
            throw new InvalidArgumentError(`expected an integer between ${min} and ${max}`);
        }
        return number;
    };

/** A positive decimal number (`0.5`, `20`) up to `max`. */
export const positiveNumberArg =
    (max: number) =>
    (value: string): number => {
        const number = /^\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
        if (!Number.isFinite(number) || number <= 0 || number > max) {
            throw new InvalidArgumentError(`expected a positive number up to ${max}`);
        }
        return number;
    };

/** A chain id. */
export const chainIdArg = (value: string): number => integerArg({ min: 1, max: Number.MAX_SAFE_INTEGER })(value);

/** Comma separated chain ids, deduplicated. */
export const chainIdListArg = (value: string): number[] =>
    R.pipe(
        value.split(','),
        R.map((part) => part.trim()),
        R.filter((part) => part !== ''),
        R.map(chainIdArg),
        R.unique()
    );

/** A block number (decimal digits). */
export const blockArg = (value: string): bigint => {
    if (!DIGITS.test(value)) throw new InvalidArgumentError('expected a block number');
    return BigInt(value);
};

/** An http(s) URL. */
export const httpUrlArg = (value: string): string => {
    const url = URL.parse(value);
    if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
        throw new InvalidArgumentError('expected an http(s) URL');
    }
    return value;
};

/** Comma separated http(s) URLs. */
export const httpUrlListArg = (value: string): string[] =>
    R.pipe(
        value.split(','),
        R.map((part) => part.trim()),
        R.filter((part) => part !== ''),
        R.map(httpUrlArg)
    );

/** A SQL identifier (a schema name). */
export const identifierArg = (value: string): string => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new InvalidArgumentError('expected a SQL identifier ([A-Za-z_][A-Za-z0-9_]*)');
    }
    return value;
};

/** Comma separated names, each one of `choices`. */
export const choiceListArg =
    <const T extends string>(choices: readonly T[]) =>
    (value: string): T[] => {
        const names = R.pipe(
            value.split(','),
            R.map((name) => name.trim()),
            R.filter((name) => name !== '')
        );
        const unknown = R.filter(names, (name) => !(choices as readonly string[]).includes(name));
        if (unknown.length > 0 || names.length === 0) {
            throw new InvalidArgumentError(`unknown value(s) ${unknown.join(', ')} (known: ${choices.join(', ')})`);
        }
        return names as T[];
    };

/**
 * Makes `command` throw instead of exiting and printing (tests, and callers that parse an argument list themselves):
 * the thrown CommanderError carries commander's message.
 */
export const throwingCommand = (command: Command): Command =>
    command.exitOverride().configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
