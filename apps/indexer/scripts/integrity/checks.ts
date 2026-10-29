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
import { type Sql, ident, join, param, sql } from '@beefy/clickhouse';
import * as R from 'remeda';
import { zeroAddress } from 'viem';
import { z } from 'zod';

import { type CatalogProduct, coverageEntities, type IndexedEntity } from './catalog.ts';
import { type ClickHouseClient, inChains, table } from './clickhouse.ts';

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
 * `from` must alias its main table `t`; it may read the probe's named CTEs (`ctes`, lowercase names). Values are
 * parameters (`param`) of the fragments. `scope`: `contract` keeps rows whose `t.id` is a catalog product, `token` rows
 * whose `chainId-token` is one, `none` every row of the requested chains.
 */
type Probe = {
    id: string;
    section: Section;
    severity: Severity;
    ctes?: ReadonlyArray<readonly [name: string, sql: Sql]>;
    from: Sql;
    where: Sql;
    scope: 'contract' | 'token' | 'none';
};

/** ClickHouse keeps BigInt columns without a precision as strings: compare them as Int256. */
export const int256 = (column: Sql) => sql`toInt256OrZero(toString(${column}))`;

/** `chainId-token` of a ledger row, comparable with catalog ids. */
export const tokenKey = (alias = 't') =>
    sql`concat(toString(${ident(alias)}.chain_id), '-', toString(${ident(alias)}.token))`;

/** `WITH a AS (...), b AS (...)` from named CTEs (names through `ident`); empty without any. */
const withClause = (ctes: ReadonlyArray<readonly [name: string, sql: Sql]>): Sql =>
    ctes.length === 0
        ? sql``
        : sql`WITH ${join(
              R.map(ctes, ([name, body]) => sql`${ident(name)} AS (${body})`),
              sql`,\n     `
          )}\n`;

/** Links every contract of a kind must have once its facts were read. */
const REQUIRED_LINKS: ReadonlyArray<{ kind: string; relation: string; severity: Severity }> = [
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

/** Links every contract of a kind must have once its facts were read. */
export const requiredLinks = () => REQUIRED_LINKS;

/** Kinds whose address is a share token (must have a Token row). */
const SHARE_TOKEN_KINDS: readonly string[] = [
    'VAULT',
    'BOOST',
    'REWARD_POOL',
    'CLM_MANAGER',
    'ERC4626_ADAPTER',
    'LST_VAULT',
    'TOKEN',
];

/** Kinds whose address is a share token (must have a Token row). */
export const shareTokenKinds = () => SHARE_TOKEN_KINDS;

/** Catalog-scoped probes only see catalog kinds; strategies are checked over every indexed row. */
const CATALOG_KINDS = new Set(['VAULT', 'BOOST', 'REWARD_POOL', 'CLM_MANAGER', 'LST_VAULT', 'SWAPPER']);

const missingLink = ({ kind, relation, severity }: (typeof REQUIRED_LINKS)[number]): Probe => ({
    id: `${kind}.missing-${relation}`,
    section: 'structure',
    severity,
    ctes: [
        [
            'linked',
            sql`SELECT chain_id, from_address FROM ${table('ContractLink')} WHERE toString(relation) = ${param('String', relation)}`,
        ],
    ],
    from: sql`${table('Contract')} AS t LEFT ANTI JOIN linked AS l ON l.chain_id = t.chain_id AND l.from_address = t.address`,
    where: sql`toString(t.kind) = ${param('String', kind)} AND t.facts_block IS NOT NULL`,
    scope: CATALOG_KINDS.has(kind) ? 'contract' : 'none',
});

const STRUCTURE_PROBES: readonly Probe[] = [
    {
        id: 'Contract.id-mismatch',
        section: 'structure',
        severity: 'error',
        from: sql`${table('Contract')} AS t`,
        where: sql`t.id != concat(toString(t.chain_id), '-', t.address)`,
        scope: 'none',
    },
    {
        id: 'Contract.facts-unread',
        section: 'structure',
        severity: 'warning',
        from: sql`${table('Contract')} AS t`,
        where: sql`t.facts_block IS NULL AND toString(t.kind) != ${param('String', 'UNKNOWN')}`,
        scope: 'contract',
    },
    {
        id: 'Contract.facts-partial',
        section: 'structure',
        severity: 'warning',
        from: sql`${table('Contract')} AS t`,
        where: sql`toString(t.facts_status) = ${param('String', 'PARTIAL')}`,
        scope: 'contract',
    },
    {
        id: 'Contract.unclassified-proxy',
        section: 'structure',
        severity: 'warning',
        from: sql`${table('Contract')} AS t`,
        where: sql`toString(t.kind) = ${param('String', 'UNKNOWN')} AND t.deploy_name IS NULL`,
        scope: 'none',
    },
    ...R.map(REQUIRED_LINKS, missingLink),
    {
        id: 'ContractLink.zero-target',
        section: 'structure',
        severity: 'error',
        from: sql`${table('ContractLink')} AS t`,
        where: sql`t.to_address = ${param('String', zeroAddress)}`,
        scope: 'none',
    },
    {
        id: 'Token.missing-share-token',
        section: 'structure',
        severity: 'error',
        ctes: [['tokens', sql`SELECT chain_id, id FROM ${table('Token')}`]],
        from: sql`${table('Contract')} AS t LEFT ANTI JOIN tokens AS k ON k.chain_id = t.chain_id AND k.id = t.id`,
        where: sql`has(${param('Array(String)', SHARE_TOKEN_KINDS)}, toString(t.kind)) AND t.facts_block IS NOT NULL`,
        scope: 'contract',
    },
    {
        id: 'Token.invalid-share-metadata',
        section: 'structure',
        severity: 'warning',
        from: sql`${table('Token')} AS t`,
        where: sql`t.is_beefy_share AND toString(t.metadata_status) = ${param('String', 'INVALID')}`,
        scope: 'contract',
    },
];

/** The balance step function: BALANCE `TimelineEvent` rows, the share token (or boost) as `token`. */
const BALANCE_STEPS = [
    'balance_steps',
    sql`SELECT id, chain_id, contract AS token, account, delta, shares_after AS balance_after, block_number, log_index
     FROM ${table('TimelineEvent')} WHERE toString(kind) = ${param('String', 'BALANCE')}`,
] as const;
/** The balance after each account's last change. */
const LAST_CHANGE = [
    'last_change',
    sql`SELECT chain_id, token, account, argMax(balance_after, (block_number, log_index)) AS last_after
     FROM balance_steps GROUP BY chain_id, token, account`,
] as const;
/** Each step with the balance after the previous step of the same account. */
const PREVIOUS_AFTER = [
    'previous_after',
    sql`SELECT id, chain_id, token, balance_after, delta,
            lagInFrame(toNullable(balance_after), 1, NULL) OVER (PARTITION BY chain_id, token, account ORDER BY block_number, log_index
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS prev_after
     FROM balance_steps`,
] as const;
const BALANCE_SUMS = [
    'balance_sums',
    sql`SELECT chain_id, token, sum(${int256(sql`balance`)}) AS balance_sum FROM ${table('Balance')} GROUP BY chain_id, token`,
] as const;

const SANITY_PROBES: readonly Probe[] = [
    {
        id: 'Balance.negative',
        section: 'sanity',
        severity: 'error',
        from: sql`${table('Balance')} AS t`,
        where: sql`${int256(sql`t.balance`)} < 0`,
        scope: 'token',
    },
    {
        id: 'Balance.drift-from-last-change',
        section: 'sanity',
        severity: 'error',
        ctes: [BALANCE_STEPS, LAST_CHANGE],
        from: sql`${table('Balance')} AS t INNER JOIN last_change AS ch ON ch.chain_id = t.chain_id AND ch.token = t.token AND ch.account = t.account`,
        where: sql`${int256(sql`ch.last_after`)} != ${int256(sql`t.balance`)}`,
        scope: 'token',
    },
    {
        id: 'TimelineEvent.balance-discontinuity',
        section: 'sanity',
        severity: 'error',
        ctes: [BALANCE_STEPS, PREVIOUS_AFTER],
        from: sql`previous_after AS t`,
        where: sql`${int256(sql`t.balance_after`)} - ${int256(sql`t.delta`)} != ifNull(${int256(sql`t.prev_after`)}, 0)`,
        scope: 'token',
    },
    {
        id: 'TokenSupply.negative',
        section: 'sanity',
        severity: 'error',
        from: sql`${table('TokenSupply')} AS t`,
        where: sql`${int256(sql`t.total_supply`)} < 0`,
        scope: 'token',
    },
    {
        id: 'TokenSupply.below-tracked-balances',
        section: 'sanity',
        severity: 'error',
        ctes: [BALANCE_SUMS],
        from: sql`${table('TokenSupply')} AS t INNER JOIN balance_sums AS s ON s.chain_id = t.chain_id AND s.token = t.token`,
        where: sql`s.balance_sum > ${int256(sql`t.total_supply`)}`,
        scope: 'token',
    },
    {
        id: 'ClmPoolState.read-failed',
        section: 'sanity',
        severity: 'warning',
        from: sql`${table('ClmPoolState')} AS t`,
        where: sql`toString(t.status) = ${param('String', 'FAILED')}`,
        scope: 'none',
    },
];

/** Registry probes: links, token metadata, ids. */
export const structureProbes = (): readonly Probe[] => STRUCTURE_PROBES;
/** Ledger probes: running sums against the step function. */
export const sanityProbes = (): readonly Probe[] => SANITY_PROBES;
export const allProbes = (): readonly Probe[] => [...STRUCTURE_PROBES, ...SANITY_PROBES];

/** The probe's catalog filter; the (large) catalog is a parameter only of the probes that read it (it travels in the URL). */
export const scopePredicate = (probe: Probe, catalogIds: readonly string[]): Sql => {
    switch (probe.scope) {
        case 'contract':
            return sql`has(${param('Array(String)', catalogIds)}, toString(t.id))`;
        case 'token':
            return sql`has(${param('Array(String)', catalogIds)}, ${tokenKey('t')})`;
        case 'none':
            return sql`1`;
    }
};

export const probeWhere = (probe: Probe, chainIds: readonly number[], catalogIds: readonly string[]): Sql =>
    sql`${inChains(chainIds, 't')} AND ${scopePredicate(probe, catalogIds)} AND (${probe.where})`;

/** The probe's count and sample queries (`WITH` its CTEs). */
export const probeQueries = (
    probe: Probe,
    chainIds: readonly number[],
    catalogIds: readonly string[],
    sampleSize: number
): { count: Sql; sample: Sql } => {
    const head = withClause(probe.ctes ?? []);
    const where = probeWhere(probe, chainIds, catalogIds);
    return {
        count: sql`${head}SELECT count() AS count FROM ${probe.from} WHERE ${where}`,
        sample: sql`${head}SELECT t.id AS id FROM ${probe.from} WHERE ${where} ORDER BY t.id LIMIT ${param('UInt32', sampleSize)}`,
    };
};

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
    for (const entity of coverageEntities()) {
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

const countRow = z.object({ count: z.union([z.string(), z.number()]) });
const idRow = z.object({ id: z.string() });

const runProbe = async (
    client: ClickHouseClient,
    probe: Probe,
    chainIds: readonly number[],
    sampleSize: number,
    catalogIds: readonly string[]
): Promise<Finding> => {
    const queries = probeQueries(probe, chainIds, catalogIds, sampleSize);
    const [countRows, sampleRows] = await Promise.all([
        client.query(queries.count, countRow),
        client.query(queries.sample, idRow),
    ]);
    return finding(
        probe.section,
        probe.severity,
        probe.id,
        Number(countRows[0]?.count ?? 0),
        R.map(sampleRows, (row) => row.id)
    );
};

type IntegrityOptions = {
    chainIds: readonly number[];
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
    for (const probe of allProbes()) {
        log(`probe ${probe.id}`);
        pushIfAny(findings, await runProbe(client, probe, chainIds, sampleSize, catalogIds));
    }
    return findings;
};
