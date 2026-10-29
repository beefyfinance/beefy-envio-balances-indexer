import { describeError } from '@beefy/config';
import { CommanderError } from 'commander';

import { accessStatements } from './access.ts';
import { createProgram } from './cli/program.ts';
import { createClickhouseClient } from './client.ts';
import {
    advance,
    cleanup,
    deploy,
    listDeployments,
    markReady,
    migrate,
    readiness,
    reprice,
    rewind,
    switchVersion,
} from './deployments.ts';
import { readConfig } from './lib/config.ts';
import { schemaFromConfig } from './sql.ts';
import { defaultSyntheticSize, seedSynthetic } from './synthetic.ts';
import { createScratchRaw } from './testing.ts';

const config = readConfig();
const client = createClickhouseClient({
    url: config.clickhouse.url,
    username: config.clickhouse.username,
    password: config.clickhouse.password,
});
const schema = schemaFromConfig(config.clickhouse);
const gate = config.reprice;

const print = (value: unknown): void => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const required = (name: string, value: string | undefined): string => {
    if (value === undefined) throw new Error(`${name} is required for this command`);
    return value;
};

const program = createProgram({
    migrate: () => migrate(client, schema),
    access: async (prefix) => {
        for (const statement of accessStatements(schema, {
            pipelinePassword: required('PIPELINE_PASSWORD', config.pipelinePassword),
            apiPassword: required('API_PASSWORD', config.apiPassword),
            envioDatabasePrefix: prefix ?? schema.envioDatabasePrefix,
        })) {
            await client.command(statement);
        }
    },
    deploy: (version, envioDatabase) => deploy(client, schema, version, envioDatabase),
    list: async () => print(await listDeployments(client, schema)),
    advance: async () => print(await advance(client, schema, config.reprice)),
    readiness: async (version) => print(await readiness(client, schema, version, gate)),
    ready: (version, { force }) => markReady(client, schema, version, { ...gate, force }),
    switch: (version, { force }) => switchVersion(client, schema, version, { ...gate, force }),
    rewind: (version, time) => rewind(client, schema, version, time),
    reprice: async (version, from, to) =>
        print({ statements: await reprice(client, schema, version, from, to, config.reprice) }),
    cleanup: async ({ graceHours }) =>
        print(await cleanup(client, schema, { graceHours: graceHours ?? config.reprice.cleanupGraceHours })),
    seedSynthetic: async (envioDatabase, size) => {
        if (!config.allowSynthetic) {
            throw new Error(
                'seed-synthetic writes fake data: set ALLOW_SYNTHETIC=yes and point the databases at a scratch ClickHouse'
            );
        }
        const defaults = defaultSyntheticSize();
        await createScratchRaw(client, envioDatabase);
        await seedSynthetic(client, schema, envioDatabase, {
            events: size.events ?? defaults.events,
            products: size.products ?? defaults.products,
            accounts: size.accounts ?? defaults.accounts,
            days: size.days ?? defaults.days,
        });
    },
});

try {
    await program.parseAsync(process.argv);
} catch (error) {
    // commander already printed its usage errors; anything else is the command's failure
    if (!(error instanceof CommanderError)) process.stderr.write(`error: ${describeError(error)}\n`);
    process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
} finally {
    // the client keeps connections alive: close them, or the process waits for them to time out
    await client.close();
}
