import { describe, expect, it } from 'vitest';

import {
    ConfigError,
    integer,
    listOf,
    oneOf,
    optionalString,
    parseEnv,
    redact,
    requiredString,
    requiredUrl,
} from './env.ts';

describe('parseEnv', () => {
    const shape = {
        name: requiredString('NAME'),
        mode: oneOf('MODE', ['a', 'b'], 'a'),
        port: integer('PORT', 3000, { min: 1, max: 65535 }),
        label: optionalString('LABEL', 'x'),
        db: requiredUrl('DB', ['postgres:', 'postgresql:']),
    };

    it('reads typed values and applies defaults', () => {
        expect(parseEnv({ NAME: 'n', DB: 'postgres://u:p@h/d', PORT: '8080' }, shape)).toEqual({
            name: 'n',
            mode: 'a',
            port: 8080,
            label: 'x',
            db: 'postgres://u:p@h/d',
        });
    });

    it('reports every problem at once', () => {
        const error = (() => {
            try {
                parseEnv({ MODE: 'z', PORT: '70000', DB: 'mysql://h/d' }, shape);
            } catch (caught) {
                return caught;
            }
        })();
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).problems).toEqual([
            'NAME is required',
            'MODE must be one of a, b',
            'PORT must be an integer between 1 and 65535',
            'DB must use postgres: or postgresql:',
        ]);
    });

    it('treats blank values as missing', () => {
        expect(() => parseEnv({ NAME: '   ', DB: 'postgres://h/d' }, shape)).toThrow('NAME is required');
    });

    it('redacts credentials', () => {
        expect(redact('postgres://user:secret@host:5432/db')).toBe('postgres://***:***@host:5432/db');
        expect(redact('not a url')).toBe('***');
    });

    it('reads comma separated lists of known values', () => {
        const jobs = { jobs: listOf('JOBS', ['a', 'b', 'c'], ['a', 'b']) };
        expect(parseEnv({}, jobs).jobs).toEqual(['a', 'b']);
        expect(parseEnv({ JOBS: ' c, a ,c' }, jobs).jobs).toEqual(['c', 'a']);
        expect(() => parseEnv({ JOBS: 'a,zzz' }, jobs)).toThrow('JOBS has unknown values zzz');
    });
});
