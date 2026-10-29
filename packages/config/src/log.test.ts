import { describe, expect, it } from 'vitest';

import { createLogger } from './log.ts';

describe('createLogger', () => {
    const captured = () => {
        const out: unknown[] = [];
        const err: unknown[] = [];
        const log = createLogger('test', {
            out: { write: (text: string) => out.push(JSON.parse(text)) },
            err: { write: (text: string) => err.push(JSON.parse(text)) },
        });
        return { out, err, log };
    };

    it('writes one JSON object per line, tagged with the app and the level name', () => {
        const { out, err, log } = captured();
        log.info({ event: 'started', port: 3000 });
        expect(out).toEqual([{ app: 'test', level: 'info', time: expect.any(Number), event: 'started', port: 3000 }]);
        expect(err).toEqual([]);
    });

    it('sends warnings and errors to stderr only', () => {
        const { out, err, log } = captured();
        log.warn({ event: 'slow' });
        log.error({ event: 'failed' }, 'it broke');
        expect(out).toEqual([]);
        expect(err).toMatchObject([
            { level: 'warn', event: 'slow' },
            { level: 'error', event: 'failed', msg: 'it broke' },
        ]);
    });

    it('drops debug lines', () => {
        const { out, err, log } = captured();
        log.debug({ event: 'noise' });
        expect([...out, ...err]).toEqual([]);
    });
});
