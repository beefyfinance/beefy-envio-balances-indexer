/**
 * Post-sync integrity audit: Beefy catalog coverage, then structural and sanity checks.
 *
 * Usage:
 *   pnpm integrity --chains 4326,4663,8453,9745,42161,43114
 *
 * Reads indexed rows from ClickHouse (ENVIO_CLICKHOUSE_HOST, default http://localhost:8123).
 * Hard failures (missing active products, broken graphs, array mismatches, id/address drift) exit 1.
 * EOL gaps, missing configured swappers, zero prices, unknown platforms, and ledger drift are warnings.
 * Indexed products that the Beefy API does not list are ignored.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    COVERAGE_ENTITIES,
    configuredLstProducts,
    configuredSwapperProducts,
    fetchCatalog,
    type IndexedEntity,
    loadActiveChainIds,
    loadVaultBlacklist,
    productId,
} from './catalog';
import { type Finding, runIntegrityChecks, type Section, type Severity } from './checks';
import { clickHouseConfigFromEnv, createClickHouseClient, fetchIds } from './clickhouse';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const HELP = `Usage: pnpm integrity [--chains 8453,42161] [--sample 20] [--stuck-threshold 10]

Env:
  ENVIO_CLICKHOUSE_HOST          ClickHouse HTTP URL (default http://localhost:8123)
  ENVIO_CLICKHOUSE_DATABASE      Database (default default)
  ENVIO_CLICKHOUSE_USERNAME      User (default default)
  ENVIO_CLICKHOUSE_PASSWORD      Password (default empty)
  BEEFY_API_URL                  Catalog base URL (default https://api.beefy.finance)
`;

type CliOptions = {
    chainIds: number[];
    sampleSize: number;
    stuckThreshold: number;
};

const parseArgs = (argv: string[]): CliOptions => {
    const options: CliOptions = { chainIds: [], sampleSize: 20, stuckThreshold: 10 };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === '--help' || arg === '-h') {
            console.log(HELP);
            process.exit(0);
        }
        if (arg === '--chains') {
            if (!next) {
                throw new Error('--chains requires a comma-separated list of chain ids');
            }
            options.chainIds = next.split(',').map((part) => {
                const chainId = Number(part.trim());
                if (!Number.isInteger(chainId)) {
                    throw new Error(`Invalid chain id: ${part}`);
                }
                return chainId;
            });
            index += 1;
            continue;
        }
        if (arg === '--sample' || arg === '--stuck-threshold') {
            const value = Number(next);
            if (!Number.isInteger(value) || value < 0) {
                throw new Error(`${arg} requires a non-negative integer`);
            }
            if (arg === '--sample') {
                options.sampleSize = value;
            } else {
                options.stuckThreshold = value;
            }
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}\n${HELP}`);
    }
    return options;
};

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

const loadIndexed = async (client: ReturnType<typeof createClickHouseClient>, chainIds: number[]) => {
    const indexed = new Map<IndexedEntity, Set<string>>();
    for (const entity of COVERAGE_ENTITIES) {
        console.error(`loading ${entity} ids`);
        indexed.set(entity, await fetchIds(client, entity, chainIds));
    }
    return indexed;
};

const main = async () => {
    const options = parseArgs(process.argv.slice(2));
    const configYaml = readFileSync(join(repoRoot, 'config.yaml'), 'utf8');
    const blacklistSource = readFileSync(join(repoRoot, 'src/lib/blacklist.ts'), 'utf8');
    const chainIds = options.chainIds.length > 0 ? options.chainIds : loadActiveChainIds(configYaml);
    if (chainIds.length === 0) {
        throw new Error('No chain ids. Pass --chains or uncomment networks in config.yaml');
    }

    const clickHouse = clickHouseConfigFromEnv();
    const client = createClickHouseClient(clickHouse);

    console.error(`chains: ${chainIds.join(', ')}`);
    console.error(`clickhouse: ${clickHouse.url} db=${clickHouse.database}`);
    console.error('fetching Beefy catalog');
    const [apiProducts, indexedByEntity] = await Promise.all([
        fetchCatalog(chainIds, process.env.BEEFY_API_URL),
        loadIndexed(client, chainIds),
    ]);
    const catalog = [
        ...apiProducts,
        ...configuredLstProducts(configYaml, chainIds),
        ...configuredSwapperProducts(configYaml, chainIds),
    ];
    const blacklist = new Set(
        loadVaultBlacklist(blacklistSource).map((entry) => productId(entry.chainId, entry.address))
    );

    const findings = await runIntegrityChecks(client, {
        chainIds,
        sampleSize: options.sampleSize,
        stuckThreshold: options.stuckThreshold,
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
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
