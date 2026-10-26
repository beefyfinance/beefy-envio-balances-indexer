/**
 * Integrity checks over the raw-events tables (schema.graphql) in ClickHouse.
 *
 * - coverage: every live Beefy catalog product has a `Contract` row of the expected kind;
 * - structure: registry facts (links, token metadata, ids) are complete;
 * - sanity: running sums are consistent with the append-only step function.
 *
 * Probes are scoped to the requested chains and, when `scope` says so, to the catalog products (contract ids, or
 * share tokens for ledger tables) so that non-Beefy-API contracts do not add noise.
 */
import { type CatalogProduct, COVERAGE_ENTITIES, type IndexedEntity } from './catalog';
import { type ClickHouseClient, chainIn, sqlStringIn } from './clickhouse';

export type Severity = 'error' | 'warning' | 'info';
export type Section = 'coverage' | 'structure' | 'sanity';

export type Finding = {
    section: Section;
    severity: Severity;
    check: string;
    count: number;
    sample: string[];
};

/**
 * `from` must alias its main table `t`. `scope`: `contract` keeps rows whose `t.id` is a catalog product,
 * `token` rows whose `chainId-token` is one, `none` every row of the requested chains.
 */
type Probe = {
    id: string;
    section: Section;
    severity: Severity;
    from: string;
    where: string;
    scope: 'contract' | 'token' | 'none';
};

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** ClickHouse keeps BigInt columns without a precision as strings: compare them as Int256. */
export const int = (column: string) => `toInt256OrZero(toString(${column}))`;

/** `chainId-token` of a ledger row, comparable with catalog ids. */
export const tokenKey = (alias = 't') => `concat(toString(${alias}.chain_id), '-', ${alias}.token)`;

/** On-chain order of a row inside its chain. */
const changeSeq = (alias = 't') => `(${alias}.block_number, ${alias}.log_index)`;

/** Links every contract of a kind must have once its facts were read. */
export const REQUIRED_LINKS: ReadonlyArray<{ kind: string; relation: string; severity: Severity }> = [
    { kind: 'VAULT', relation: 'VAULT_WANT', severity: 'error' },
    { kind: 'BOOST', relation: 'BOOST_STAKED', severity: 'error' },
    { kind: 'BOOST', relation: 'BOOST_REWARD', severity: 'warning' },
    { kind: 'REWARD_POOL', relation: 'REWARD_POOL_STAKED', severity: 'error' },
    { kind: 'CLM_MANAGER', relation: 'CLM_WANT0', severity: 'error' },
    { kind: 'CLM_MANAGER', relation: 'CLM_WANT1', severity: 'error' },
    { kind: 'CLM_STRATEGY', relation: 'CLM_STRATEGY_MANAGER', severity: 'warning' },
    { kind: 'CLM_STRATEGY', relation: 'CLM_POOL', severity: 'warning' },
    { kind: 'STRATEGY', relation: 'STRATEGY_VAULT', severity: 'warning' },
    { kind: 'ERC4626_ADAPTER', relation: 'ADAPTER_VAULT', severity: 'warning' },
];

/** Kinds whose address is a share token (must have a Token row). */
export const SHARE_TOKEN_KINDS = [
    'VAULT',
    'BOOST',
    'REWARD_POOL',
    'CLM_MANAGER',
    'ERC4626_ADAPTER',
    'LST_VAULT',
    'TOKEN',
];

/** Catalog-scoped probes only see catalog kinds; strategies are checked over every indexed row. */
const CATALOG_KINDS = new Set(['VAULT', 'BOOST', 'REWARD_POOL', 'CLM_MANAGER', 'LST_VAULT', 'SWAPPER']);

const missingLink = ({ kind, relation, severity }: (typeof REQUIRED_LINKS)[number]): Probe => ({
    id: `${kind}.missing-${relation}`,
    section: 'structure',
    severity,
    from: 'Contract AS t',
    where: `t.kind = '${kind}' AND t.facts_block IS NOT NULL AND (t.chain_id, t.address) NOT IN (SELECT chain_id, from_address FROM ContractLink WHERE relation = '${relation}')`,
    scope: CATALOG_KINDS.has(kind) ? 'contract' : 'none',
});

export const STRUCTURE_PROBES: Probe[] = [
    {
        id: 'Contract.id-mismatch',
        section: 'structure',
        severity: 'error',
        from: 'Contract AS t',
        where: `t.id != concat(toString(t.chain_id), '-', t.address)`,
        scope: 'none',
    },
    {
        id: 'Contract.facts-unread',
        section: 'structure',
        severity: 'warning',
        from: 'Contract AS t',
        where: `t.facts_block IS NULL AND t.kind != 'UNKNOWN'`,
        scope: 'contract',
    },
    {
        id: 'Contract.facts-partial',
        section: 'structure',
        severity: 'warning',
        from: 'Contract AS t',
        where: `t.facts_status = 'PARTIAL'`,
        scope: 'contract',
    },
    {
        id: 'Contract.unclassified-proxy',
        section: 'structure',
        severity: 'warning',
        from: 'Contract AS t',
        where: `t.kind = 'UNKNOWN' AND t.deploy_name IS NULL`,
        scope: 'none',
    },
    ...REQUIRED_LINKS.map(missingLink),
    {
        id: 'ContractLink.zero-target',
        section: 'structure',
        severity: 'error',
        from: 'ContractLink AS t',
        where: `t.to_address = '${ZERO_ADDRESS}'`,
        scope: 'none',
    },
    {
        id: 'Token.missing-share-token',
        section: 'structure',
        severity: 'error',
        from: 'Contract AS t',
        where: `${sqlStringIn('t.kind', SHARE_TOKEN_KINDS)} AND t.facts_block IS NOT NULL AND (t.chain_id, t.id) NOT IN (SELECT chain_id, id FROM Token)`,
        scope: 'contract',
    },
    {
        id: 'Token.invalid-share-metadata',
        section: 'structure',
        severity: 'warning',
        from: 'Token AS t',
        where: `t.is_beefy_share AND t.metadata_status = 'INVALID'`,
        scope: 'contract',
    },
];

const lastChange = `(SELECT chain_id, token, account, argMax(balance_after, ${changeSeq('c')}) AS last_after FROM BalanceChange AS c GROUP BY chain_id, token, account)`;
const balanceSums = `(SELECT chain_id, token, sum(${int('b.balance')}) AS balance_sum FROM Balance AS b GROUP BY chain_id, token)`;
const previousAfter = `(SELECT id, chain_id, token, balance_after, delta, lagInFrame(balance_after, 1, NULL) OVER (PARTITION BY chain_id, token, account ORDER BY block_number, log_index ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS prev_after FROM BalanceChange)`;

export const SANITY_PROBES: Probe[] = [
    {
        id: 'Balance.negative',
        section: 'sanity',
        severity: 'error',
        from: 'Balance AS t',
        where: `${int('t.balance')} < 0`,
        scope: 'token',
    },
    {
        id: 'Balance.drift-from-last-change',
        section: 'sanity',
        severity: 'error',
        from: `Balance AS t INNER JOIN ${lastChange} AS ch ON ch.chain_id = t.chain_id AND ch.token = t.token AND ch.account = t.account`,
        where: `${int('ch.last_after')} != ${int('t.balance')}`,
        scope: 'token',
    },
    {
        id: 'BalanceChange.discontinuity',
        section: 'sanity',
        severity: 'error',
        from: `${previousAfter} AS t`,
        where: `${int('t.balance_after')} - ${int('t.delta')} != ifNull(${int('t.prev_after')}, 0)`,
        scope: 'token',
    },
    {
        id: 'TokenSupply.negative',
        section: 'sanity',
        severity: 'error',
        from: 'TokenSupply AS t',
        where: `${int('t.total_supply')} < 0`,
        scope: 'token',
    },
    {
        id: 'TokenSupply.below-tracked-balances',
        section: 'sanity',
        severity: 'error',
        from: `TokenSupply AS t INNER JOIN ${balanceSums} AS s ON s.chain_id = t.chain_id AND s.token = t.token`,
        where: `s.balance_sum > ${int('t.total_supply')}`,
        scope: 'token',
    },
    {
        id: 'ClmPoolState.read-failed',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmPoolState AS t',
        where: `t.status = 'FAILED'`,
        scope: 'none',
    },
];

export const ALL_PROBES: Probe[] = [...STRUCTURE_PROBES, ...SANITY_PROBES];

export const scopePredicate = (probe: Probe, catalogIds: readonly string[]) => {
    switch (probe.scope) {
        case 'contract':
            return sqlStringIn('t.id', catalogIds);
        case 'token':
            return sqlStringIn(tokenKey('t'), catalogIds);
        case 'none':
            return '1';
    }
};

export const probeWhere = (probe: Probe, chainIds: number[], catalogIds: readonly string[]) =>
    `${chainIn('t.chain_id', chainIds)} AND ${scopePredicate(probe, catalogIds)} AND (${probe.where})`;

const finding = (section: Section, severity: Severity, check: string, count: number, sample: string[]): Finding => ({
    section,
    severity,
    check,
    count,
    sample,
});

const pushIfAny = (findings: Finding[], next: Finding) => {
    if (next.count > 0) {
        findings.push(next);
    }
};

export const diffCoverage = (
    expected: CatalogProduct[],
    indexedByEntity: Map<IndexedEntity, Set<string>>,
    blacklist: Set<string>,
    sampleSize: number
): Finding[] => {
    const findings: Finding[] = [];
    for (const entity of COVERAGE_ENTITIES) {
        const indexed = indexedByEntity.get(entity) ?? new Set<string>();
        const expectedForEntity = expected.filter((product) => product.entity === entity);
        const expectedIds = new Set(expectedForEntity.map((product) => product.id));

        const missingActive: string[] = [];
        const missingEol: string[] = [];
        const expectedBlacklist: string[] = [];
        for (const product of expectedForEntity) {
            if (indexed.has(product.id)) {
                continue;
            }
            const line = `${product.id} ${product.beefyId} (${product.status})`;
            if (blacklist.has(product.id)) {
                expectedBlacklist.push(line);
            } else if (product.live) {
                missingActive.push(line);
            } else {
                missingEol.push(line);
            }
        }

        const extra = [...indexed].filter((id) => !expectedIds.has(id));
        findings.push(
            finding('coverage', 'info', `${entity}.summary`, indexed.size, [
                `expected=${expectedForEntity.length} missingActive=${missingActive.length} missingEol=${missingEol.length} blacklisted=${expectedBlacklist.length} extra=${extra.length}`,
            ])
        );
        pushIfAny(
            findings,
            finding(
                'coverage',
                entity === 'Swapper' ? 'warning' : 'error',
                entity === 'Swapper' ? 'Swapper.missing-configured' : `${entity}.missing-active`,
                missingActive.length,
                missingActive.slice(0, sampleSize)
            )
        );
        pushIfAny(
            findings,
            finding('coverage', 'warning', `${entity}.missing-eol`, missingEol.length, missingEol.slice(0, sampleSize))
        );
        pushIfAny(
            findings,
            finding(
                'coverage',
                'info',
                `${entity}.blacklisted`,
                expectedBlacklist.length,
                expectedBlacklist.slice(0, sampleSize)
            )
        );
    }
    return findings;
};

const runProbe = async (
    client: ClickHouseClient,
    probe: Probe,
    chainIds: number[],
    sampleSize: number,
    catalogIds: readonly string[]
): Promise<Finding> => {
    const where = probeWhere(probe, chainIds, catalogIds);
    const [countRows, sampleRows] = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM ${probe.from} WHERE ${where}`),
        client.query<{ id: string }>(
            `SELECT t.id AS id FROM ${probe.from} WHERE ${where} ORDER BY t.id LIMIT ${sampleSize}`
        ),
    ]);
    return finding(
        probe.section,
        probe.severity,
        probe.id,
        Number(countRows[0]?.count ?? 0),
        sampleRows.map((row) => row.id)
    );
};

type IntegrityOptions = {
    chainIds: number[];
    sampleSize: number;
    catalog: CatalogProduct[];
    indexedByEntity: Map<IndexedEntity, Set<string>>;
    blacklist: Set<string>;
    log?: (message: string) => void;
};

export const runIntegrityChecks = async (client: ClickHouseClient, options: IntegrityOptions): Promise<Finding[]> => {
    const log = options.log ?? (() => undefined);
    const { chainIds, sampleSize } = options;
    const catalogIds = [...new Set(options.catalog.map((product) => product.id))];
    const findings = diffCoverage(options.catalog, options.indexedByEntity, options.blacklist, sampleSize);
    for (const probe of ALL_PROBES) {
        log(`probe ${probe.id}`);
        pushIfAny(findings, await runProbe(client, probe, chainIds, sampleSize, catalogIds));
    }
    return findings;
};
