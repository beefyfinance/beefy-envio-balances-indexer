import { type Logger, pino } from 'pino';

export type { Logger } from 'pino';

/**
 * An app's logger (pino): one JSON object per line, tagged with the app's name (`app`), the level as its name. Lines
 * carry an `event` field naming what happened. Info and below go to stdout, warnings and errors to stderr, so the log
 * drain can alert on them. `destinations` replaces stdout and stderr (tests).
 */
export const createLogger = (
    app: string,
    destinations: { out: pino.DestinationStream; err: pino.DestinationStream } = {
        out: pino.destination(1),
        err: pino.destination(2),
    }
): Logger =>
    pino(
        { base: { app }, formatters: { level: (label) => ({ level: label }) } },
        pino.multistream(
            [
                { level: 'info', stream: destinations.out },
                { level: 'warn', stream: destinations.err },
            ],
            // each line to the stream of the highest level it reaches only
            { dedupe: true }
        )
    );
