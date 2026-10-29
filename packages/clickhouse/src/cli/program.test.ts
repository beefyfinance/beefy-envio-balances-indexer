import { CommanderError } from 'commander';
import * as R from 'remeda';
import { describe, expect, it } from 'vitest';

import { type CliCommands, createProgram } from './program.ts';

/** A program whose commands record their arguments, and whose output is captured instead of printed. */
const recording = () => {
    const calls: [string, ...unknown[]][] = [];
    const record =
        (name: string) =>
        (...args: unknown[]): Promise<void> => {
            calls.push([name, ...args]);
            return Promise.resolve();
        };
    const commands: CliCommands = {
        migrate: record('migrate'),
        access: record('access'),
        deploy: record('deploy'),
        list: record('list'),
        advance: record('advance'),
        readiness: record('readiness'),
        ready: record('ready'),
        switch: record('switch'),
        rewind: record('rewind'),
        reprice: record('reprice'),
        cleanup: record('cleanup'),
        seedSynthetic: record('seedSynthetic'),
    };
    const output: string[] = [];
    const program = createProgram(commands).configureOutput({
        writeOut: (text) => output.push(text),
        writeErr: (text) => output.push(text),
    });
    for (const command of program.commands)
        command.configureOutput({ writeOut: (text) => output.push(text), writeErr: (text) => output.push(text) });
    const run = (...args: string[]) => program.parseAsync(args, { from: 'user' });
    return { calls, output, run };
};

describe('cli', () => {
    it('parses every command into checked values', async () => {
        const { calls, run } = recording();
        await run('migrate');
        await run('access');
        await run('access', 'envio_dev_');
        await run('deploy', '3', 'envio_dev_3');
        await run('list');
        await run('advance');
        await run('readiness', '3');
        await run('ready', '3', '--force');
        await run('switch', '3');
        await run('rewind', '3', '2024-01-01 10:00:00');
        await run('reprice', '3', '2024-01-01', '2024-02-01');
        await run('cleanup', '--grace-hours', '0');
        await run('cleanup');
        await run('seed-synthetic', 'envio_load_1', '20000000', '--products', '3000');
        expect(calls).toEqual([
            ['migrate'],
            ['access', undefined],
            ['access', 'envio_dev_'],
            ['deploy', 3, 'envio_dev_3'],
            ['list'],
            ['advance'],
            ['readiness', 3],
            ['ready', 3, { force: true }],
            ['switch', 3, { force: false }],
            ['rewind', 3, '2024-01-01 10:00:00.000'],
            ['reprice', 3, '2024-01-01 00:00:00.000', '2024-02-01 00:00:00.000'],
            ['cleanup', { graceHours: 0 }],
            ['cleanup', { graceHours: undefined }],
            [
                'seedSynthetic',
                'envio_load_1',
                { events: 20_000_000, products: 3000, accounts: undefined, days: undefined },
            ],
        ]);
    });

    it('refuses hostile or malformed arguments before running anything, with a usage error', async () => {
        const { calls, output, run } = recording();
        for (const args of [
            ['deploy', '3; DROP', 'envio_dev_3'],
            ['deploy', '3', 'envio_dev_3`; DROP DATABASE default'],
            ['deploy', '0', 'envio_dev_0'],
            ['rewind', '3', "2024-01-01'; DROP"],
            ['rewind', '3', '2024-02-30'],
            ['reprice', '3', '2024-01-01', 'now'],
            ['cleanup', '--grace-hours', '-1'],
            ['cleanup', '--grace-hours', '1e3'],
            ['access', 'a{b}'],
            ['seed-synthetic', 'x\ny'],
            ['seed-synthetic', 'envio_1', '10', '--products', '0'],
            ['readiness'],
            ['nope'],
        ]) {
            await expect(run(...args)).rejects.toBeInstanceOf(CommanderError);
        }
        expect(calls).toEqual([]);
        expect(output.join('')).toContain("error: command-argument value '3; DROP' is invalid for argument 'version'");
    });

    it('generates its help', async () => {
        const { output, run } = recording();
        await expect(run('--help')).rejects.toMatchObject({ exitCode: 0 });
        const help = output.join('');
        for (const command of [
            'migrate',
            'access',
            'deploy',
            'list',
            'advance',
            'readiness',
            'ready',
            'switch',
            'rewind',
            'reprice',
            'cleanup',
            'seed-synthetic',
        ]) {
            expect(help).toContain(command);
        }
    });

    it('fails the run when a command fails', async () => {
        const program = createProgram({
            ...R.pipe(
                [
                    'migrate',
                    'access',
                    'deploy',
                    'list',
                    'advance',
                    'readiness',
                    'ready',
                    'switch',
                    'rewind',
                    'reprice',
                    'cleanup',
                    'seedSynthetic',
                ],
                R.map((name) => [name, () => Promise.resolve()] as const),
                R.fromEntries()
            ),
            advance: () => Promise.reject(new Error('ClickHouse 500')),
        } as unknown as CliCommands);
        await expect(program.parseAsync(['advance'], { from: 'user' })).rejects.toThrow('ClickHouse 500');
    });
});
