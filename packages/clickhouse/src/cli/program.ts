import { Command, InvalidArgumentError } from 'commander';

import { ident, utcTime, versionNumber } from '../sql.ts';

/** What each command does once its arguments are parsed and checked (cli.ts wires them to ClickHouse). */
export type CliCommands = {
    migrate: () => Promise<void>;
    access: (envioDatabasePrefix: string | undefined) => Promise<void>;
    deploy: (version: number, envioDatabase: string) => Promise<void>;
    list: () => Promise<void>;
    advance: () => Promise<void>;
    readiness: (version: number) => Promise<void>;
    ready: (version: number, options: { force: boolean }) => Promise<void>;
    switch: (version: number, options: { force: boolean }) => Promise<void>;
    rewind: (version: number, time: string) => Promise<void>;
    reprice: (version: number, from: string, to: string) => Promise<void>;
    cleanup: (options: { graceHours: number | undefined }) => Promise<void>;
    seedSynthetic: (
        envioDatabase: string,
        size: {
            events: number | undefined;
            products: number | undefined;
            accounts: number | undefined;
            days: number | undefined;
        }
    ) => Promise<void>;
};

/** A commander argument parser from a checking function: its error becomes commander's usage error. */
const checked =
    <T>(check: (value: string) => T) =>
    (value: string): T => {
        try {
            return check(value);
        } catch (error) {
            throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
        }
    };

const version = checked((value) => versionNumber(value));
const time = checked(utcTime);
const name = checked((value) => {
    ident(value);
    return value;
});
const wholeNumber = (min: number, max: number) =>
    checked((value) => {
        const parsed = /^\d{1,12}$/.test(value) ? Number(value) : Number.NaN;
        if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
            throw new Error(`must be an integer between ${min} and ${max}, got ${JSON.stringify(value)}`);
        }
        return parsed;
    });

/**
 * The operations CLI: one subcommand per operation, arguments parsed and checked before anything runs (a bad version,
 * time, name or number is a usage error), generated help, and a non-zero exit on any error.
 */
export const createProgram = (commands: CliCommands): Command => {
    const program = new Command('cli.ts')
        .description('Timeline operations on ClickHouse: versions, prices, access')
        .showHelpAfterError()
        // errors are thrown (as CommanderError, after commander printed them) rather than exiting: cli.ts sets the code
        .exitOverride()
        .configureHelp({ sortSubcommands: false });

    program
        .command('migrate')
        .description('create our stable database and the deployments table')
        .action(() => commands.migrate());

    program
        .command('access')
        .description('create the users, profiles and quota (needs an administrator; PIPELINE_PASSWORD, API_PASSWORD)')
        .argument(
            '[envioDatabasePrefix]',
            'the Envio databases prefix (default: CLICKHOUSE_ENVIO_DATABASE_PREFIX)',
            name
        )
        .action((prefix: string | undefined) => commands.access(prefix));

    program
        .command('deploy')
        .description("create version N's tables and register it as building")
        .argument('<version>', 'the version number N', version)
        .argument('<envioDatabase>', "Envio's database of the version: <prefix><N>", name)
        .action((n: number, database: string) => commands.deploy(n, database));

    program
        .command('list')
        .description('the deployments')
        .action(() => commands.list());

    program
        .command('advance')
        .description('move the watermark of every live version, storing the prices it passes')
        .action(() => commands.advance());

    program
        .command('readiness')
        .description('watermark age, event counts against the active version, indexer price columns, PENDING events')
        .argument('<version>', 'the version number N', version)
        .action((n: number) => commands.readiness(n));

    program
        .command('ready')
        .description('mark a building version ready (refused with PENDING events or no indexer price columns)')
        .argument('<version>', 'the version number N', version)
        .option('--force', 'mark it ready anyway', false)
        .action((n: number, options: { force: boolean }) => commands.ready(n, { force: options.force }));

    program
        .command('switch')
        .description('point the API views at version N, retire the previous one (refused for a version not ready)')
        .argument('<version>', 'the version number N', version)
        .option('--force', 'switch anyway', false)
        .action((n: number, options: { force: boolean }) => commands.switch(n, { force: options.force }));

    program
        .command('rewind')
        .description("move version N's watermark back")
        .argument('<version>', 'the version number N', version)
        .argument('<time>', "UTC, 'YYYY-MM-DD[ HH:MM:SS[.fff]]'", time)
        .action((n: number, at: string) => commands.rewind(n, at));

    program
        .command('reprice')
        .description("reprice version N's events in [from, to) in place, in bounded statements")
        .argument('<version>', 'the version number N', version)
        .argument('<from>', "UTC, 'YYYY-MM-DD[ HH:MM:SS[.fff]]'", time)
        .argument('<to>', "UTC, 'YYYY-MM-DD[ HH:MM:SS[.fff]]'", time)
        .action((n: number, from: string, to: string) => commands.reprice(n, from, to));

    program
        .command('cleanup')
        .description('drop the versions retired for longer than the grace period')
        .option(
            '--grace-hours <hours>',
            'the grace period (default: CLEANUP_GRACE_HOURS, 48)',
            wholeNumber(0, 24 * 365)
        )
        .action((options: { graceHours?: number }) => commands.cleanup({ graceHours: options.graceHours }));

    program
        .command('seed-synthetic')
        .description(
            'create and fill a stand-in Envio database and prices (ALLOW_SYNTHETIC=yes; never against production)'
        )
        .argument('<envioDatabase>', 'the stand-in Envio database to create', name)
        .argument('[events]', 'balance changes in total', wholeNumber(1, 10_000_000_000))
        .option('--products <n>', 'products, each its own price asset', wholeNumber(1, 1_000_000))
        .option('--accounts <n>', 'accounts', wholeNumber(1, 1_000_000_000))
        .option('--days <n>', 'days of history, ending now', wholeNumber(1, 3650))
        .action(
            (
                database: string,
                events: number | undefined,
                options: { products?: number; accounts?: number; days?: number }
            ) =>
                commands.seedSynthetic(database, {
                    events,
                    products: options.products,
                    accounts: options.accounts,
                    days: options.days,
                })
        );

    return program;
};
