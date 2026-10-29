/**
 * Post-sync integrity audit: Beefy catalog coverage, then structural and sanity checks.
 *
 * Usage (`pnpm integrity --help`):
 *   pnpm integrity --chains 4326,4663,8453,9745,42161,43114
 *
 * Reads indexed rows from ClickHouse (ENVIO_CLICKHOUSE_HOST, default http://localhost:8123).
 * Hard failures (missing active products, missing registry links / share tokens, id drift, ledger drift) exit 1.
 * EOL gaps, missing configured swappers, partial or unread facts, and failed CLM pool reads are warnings.
 * Indexed products that the Beefy API does not list are ignored.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';
import * as R from 'remeda';

import { describeError } from '../../src/lib/errors.ts';
import { chainIdListArg, integerArg } from '../lib/cli.ts';
import { scriptsConfig } from '../lib/config.ts';
import {
    configuredLstProducts,
    configuredSwapperProducts,
    coverageEntities,
    entityKinds,
    fetchCatalog,
    type IndexedEntity,
    loadActiveChainIds,
    loadVaultBlacklist,
    productId,
} from './catalog.ts';
import { type Finding, runIntegrityChecks, type Section, type Severity } from './checks.ts';
import { type ClickHouseClient, createClickHouseClient, fetchContractIds } from './clickhouse.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

type CliOptions = {
    chains?: number[];
    sample: number;
};

const command = new Command('integrity')
    .description('Post-sync integrity audit: Beefy catalog coverage, then structural and sanity checks (ClickHouse).')
    .option('--chains <ids>', 'comma-separated chain ids (default: every chain in config.yaml)', chainIdListArg)
    .option('--sample <n>', 'ids shown per finding', integerArg({ min: 0, max: 10_000 }), 20)
    .addHelpText(
        'after',
        `
Environment (scripts/lib/config.ts):
  ENVIO_CLICKHOUSE_HOST          ClickHouse HTTP URL (default http://localhost:8123)
  ENVIO_CLICKHOUSE_DATABASE      Database (default default)
  ENVIO_CLICKHOUSE_USERNAME      User (default default)
  ENVIO_CLICKHOUSE_PASSWORD      Password (default empty)
  BEEFY_API_URL                  Catalog base URL (default https://api.beefy.finance)`
    );

const printFinding = (item: Finding) => {
    const label = item.severity.toUpperCase().padEnd(7, ' ');
    console.log(`[${label}] ${item.check} (${item.count})`);
    for (const line of item.sample) {
        console.log(`  - ${line}`);
    }
    if (!item.check.endsWith('.summary') && item.count > item.sample.length) {
        console.log(`  - … and ${item.count - item.sample.length} more`);
    }
};

const printReport = (findings: Finding[]) => {
    const sections: Section[] = ['coverage', 'structure', 'sanity'];
    for (const section of sections) {
        const items = findings.filter((item) => item.section === section);
        console.log(`\n## ${section}`);
        if (items.length === 0) {
            console.log('ok');
            continue;
        }
        for (const item of items) {
            printFinding(item);
        }
    }
};

const countSeverity = (findings: Finding[], severity: Severity) =>
    findings.filter((item) => item.severity === severity).length;

const loadIndexed = async (client: ClickHouseClient, chainIds: readonly number[]) => {
    const indexed = new Map<IndexedEntity, Set<string>>();
    for (const entity of coverageEntities()) {
        console.error(`loading ${entity} contract ids`);
        indexed.set(entity, await fetchContractIds(client, entityKinds(entity), chainIds));
    }
    return indexed;
};

const main = async () => {
    const options = command.parse().opts<CliOptions>();
    const config = scriptsConfig();
    const configYaml = readFileSync(join(repoRoot, 'config.yaml'), 'utf8');
    const blacklistSource = readFileSync(join(repoRoot, 'src/lib/blacklist.ts'), 'utf8');
    const chainIds = options.chains ?? loadActiveChainIds(configYaml);
    if (chainIds.length === 0) {
        throw new Error('No chain ids. Pass --chains or add chains to config.yaml');
    }

    const client = createClickHouseClient(config.clickhouse);

    console.error(`chains: ${chainIds.join(', ')}`);
    console.error(`clickhouse: ${new URL(config.clickhouse.url).host} db=${config.clickhouse.database}`);
    console.error('fetching Beefy catalog');
    const [apiProducts, indexedByEntity] = await Promise.all([
        fetchCatalog(chainIds, config.beefyApiUrl, (message) => console.error(message)),
        loadIndexed(client, chainIds),
    ]);
    const catalog = [
        ...apiProducts,
        ...configuredLstProducts(configYaml, chainIds),
        ...configuredSwapperProducts(configYaml, chainIds),
    ];
    const blacklist = new Set(
        R.map(loadVaultBlacklist(blacklistSource), (entry) => productId(entry.chainId, entry.address))
    );

    const findings = await runIntegrityChecks(client, {
        chainIds,
        sampleSize: options.sample,
        catalog,
        indexedByEntity,
        blacklist,
        log: (message) => console.error(message),
    });

    console.log(`# Indexer integrity`);
    console.log(`chains: ${chainIds.join(', ')}`);
    printReport(findings);
    const errors = countSeverity(findings, 'error');
    const warnings = countSeverity(findings, 'warning');
    console.log(`\n${errors} error group(s), ${warnings} warning group(s)`);
    process.exit(errors > 0 ? 1 : 0);
};

main().catch((error: unknown) => {
    console.error(describeError(error));
    process.exit(1);
});
