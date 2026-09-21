import type { CatalogProduct, IndexedEntity } from './catalog';
import { type ClickHouseClient, chainIn } from './clickhouse';

export type Severity = 'error' | 'warning' | 'info';
export type Section = 'coverage' | 'structure' | 'sanity';

export type Finding = {
    section: Section;
    severity: Severity;
    check: string;
    count: number;
    sample: string[];
};

const COVERAGE_ENTITIES: IndexedEntity[] = ['Classic', 'Clm', 'RewardPool', 'ClassicBoost', 'LstVault'];

const STUCK_ENTITIES = [
    'Classic',
    'Clm',
    'ClassicVault',
    'ClmManager',
    'ClassicBoost',
    'ClassicErc4626Adapter',
    'RewardPool',
    'LstVault',
] as const;

const DECIMAL_SCALE = 24;

type Probe = {
    id: string;
    section: Section;
    severity: Severity;
    from: string;
    where: string;
};

const initialized = `t.initializable_status = 'INITIALIZED'`;
const blank = (column: string) => `(t.${column} IS NULL OR t.${column} = '')`;
const dec = (column: string) => `toDecimal256OrZero(${column}, 24)`;
const missingField = (table: string, column: string, id: string): Probe => ({
    id,
    section: 'structure',
    severity: 'error',
    from: `${table} AS t`,
    where: `${initialized} AND ${blank(column)}`,
});

const nullMetadata = (table: string, tokenColumn: string, id: string): Probe => ({
    id,
    section: 'structure',
    severity: 'error',
    from: `${table} AS t LEFT JOIN Token AS token ON token.id = t.${tokenColumn}`,
    where: `${initialized} AND (token.id IS NULL OR token.symbol IS NULL OR token.symbol = '' OR token.name IS NULL OR token.name = '')`,
});

/** Hard failures: incomplete INITIALIZED graphs and share tokens without metadata. */
export const STRUCTURE_PROBES: Probe[] = [
    missingField('Classic', 'classic_vault_id', 'classic.missing-vault'),
    missingField('Classic', 'classic_vault_strategy_id', 'classic.missing-strategy'),
    missingField('Clm', 'clm_manager_id', 'clm.missing-manager'),
    missingField('Clm', 'clm_strategy_id', 'clm.missing-strategy'),
    missingField('ClassicVault', 'classic_id', 'classicVault.missing-aggregate'),
    missingField('ClmManager', 'clm_id', 'clmManager.missing-aggregate'),
    missingField('ClassicBoost', 'classic_id', 'classicBoost.missing-aggregate'),
    missingField('ClassicErc4626Adapter', 'classic_id', 'erc4626Adapter.missing-aggregate'),
    {
        id: 'rewardPool.orphan',
        section: 'structure',
        severity: 'error',
        from: 'RewardPool AS t',
        where: `${initialized} AND ${blank('classic_id')} AND ${blank('clm_id')}`,
    },
    missingField('Classic', 'vault_token_id', 'classic.missing-vault-token'),
    missingField('Classic', 'underlying_token_id', 'classic.missing-underlying-token'),
    missingField('Clm', 'manager_token_id', 'clm.missing-manager-token'),
    missingField('Clm', 'underlying_token0_id', 'clm.missing-token0'),
    missingField('Clm', 'underlying_token1_id', 'clm.missing-token1'),
    missingField('ClassicVault', 'share_token_id', 'classicVault.missing-share-token'),
    missingField('ClassicVault', 'underlying_token_id', 'classicVault.missing-underlying-token'),
    missingField('ClassicBoost', 'share_token_id', 'classicBoost.missing-share-token'),
    missingField('ClassicBoost', 'underlying_token_id', 'classicBoost.missing-underlying-token'),
    missingField('ClassicErc4626Adapter', 'share_token_id', 'erc4626Adapter.missing-share-token'),
    missingField('ClassicErc4626Adapter', 'underlying_token_id', 'erc4626Adapter.missing-underlying-token'),
    missingField('RewardPool', 'share_token_id', 'rewardPool.missing-share-token'),
    missingField('RewardPool', 'underlying_token_id', 'rewardPool.missing-underlying-token'),
    missingField('LstVault', 'share_token_id', 'lstVault.missing-share-token'),
    missingField('LstVault', 'underlying_token_id', 'lstVault.missing-underlying-token'),
    nullMetadata('Classic', 'vault_token_id', 'classic.vault-token-metadata'),
    nullMetadata('Clm', 'manager_token_id', 'clm.manager-token-metadata'),
    nullMetadata('ClassicVault', 'share_token_id', 'classicVault.share-token-metadata'),
    nullMetadata('ClassicBoost', 'share_token_id', 'classicBoost.share-token-metadata'),
    nullMetadata('ClassicErc4626Adapter', 'share_token_id', 'erc4626Adapter.share-token-metadata'),
    nullMetadata('RewardPool', 'share_token_id', 'rewardPool.share-token-metadata'),
    nullMetadata('LstVault', 'share_token_id', 'lstVault.share-token-metadata'),
];

const positiveSupply = (column: string) => `${dec(`t.${column}`)} > 0`;
const zeroPrice = (column: string) => `${dec(`t.${column}`)} = 0`;

/** Warnings: required scalars that default to 0 / UNKNOWN instead of null. */
export const SANITY_PROBES: Probe[] = [
    {
        id: 'classic.zero-native-price',
        section: 'sanity',
        severity: 'warning',
        from: 'Classic AS t',
        where: `${initialized} AND ${positiveSupply('vault_token_total_supply')} AND ${zeroPrice('native_to_usd_price')}`,
    },
    {
        id: 'classic.zero-underlying-price',
        section: 'sanity',
        severity: 'warning',
        from: 'Classic AS t',
        where: `${initialized} AND ${positiveSupply('vault_token_total_supply')} AND ${zeroPrice('underlying_to_native_price')}`,
    },
    {
        id: 'classic.unknown-platform',
        section: 'sanity',
        severity: 'warning',
        from: 'Classic AS t',
        where: `${initialized} AND t.underlying_platform = 'UNKNOWN'`,
    },
    {
        id: 'clm.zero-native-price',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t',
        where: `${initialized} AND ${positiveSupply('manager_total_supply')} AND ${zeroPrice('native_to_usd_price')}`,
    },
    {
        id: 'clm.zero-underlying-prices',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t',
        where: `${initialized} AND ${positiveSupply('manager_total_supply')} AND ${zeroPrice('token0_to_native_price')} AND ${zeroPrice('token1_to_native_price')}`,
    },
    {
        id: 'clm.zero-protocol-pool',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t',
        where: `${initialized} AND hex(t.underlying_protocol_pool) IN ('', '0000000000000000000000000000000000000000')`,
    },
];

const CLASSIC_ARRAY_GROUPS = [
    [
        'underlying_breakdown_token_ids',
        'underlying_breakdown_tokens_order',
        'vault_underlying_breakdown_balances',
        'underlying_breakdown_to_native_prices',
    ],
    ['reward_pool_token_ids', 'reward_pool_tokens_order', 'reward_pools_total_supply'],
    ['boost_reward_token_ids', 'boost_reward_tokens_order', 'boost_reward_to_native_prices'],
    ['reward_token_ids', 'reward_tokens_order', 'reward_to_native_prices'],
    [
        'erc4626_adapter_token_ids',
        'erc4626_adapter_tokens_order',
        'erc4626_adapters_total_supply',
        'erc4626_adapter_vault_shares_balances',
    ],
] as const;

const CLM_ARRAY_GROUPS = [
    ['reward_pool_token_ids', 'reward_pool_tokens_order', 'reward_pools_total_supply'],
    ['output_token_ids', 'output_tokens_order', 'output_to_native_prices'],
    ['reward_token_ids', 'reward_tokens_order', 'reward_to_native_prices'],
] as const;

/**
 * Permissionless factories index products Beefy does not list. Structure and sanity
 * checks only apply to catalog ids (API products, plus configured LST vaults).
 * ClassicVault shares the Classic vault address; ClmManager shares the Clm manager address.
 */
const catalogScope = (from: string): { entity: IndexedEntity; column: string } => {
    switch (from.split(' ')[0]) {
        case 'Classic':
        case 'ClassicVault':
            return { entity: 'Classic', column: 't.id' };
        case 'Clm':
        case 'ClmManager':
            return { entity: 'Clm', column: 't.id' };
        case 'ClassicBoost':
            return { entity: 'ClassicBoost', column: 't.id' };
        case 'RewardPool':
            return { entity: 'RewardPool', column: 't.id' };
        case 'LstVault':
            return { entity: 'LstVault', column: 't.id' };
        case 'ClassicErc4626Adapter':
            return { entity: 'Classic', column: 't.classic_id' };
        case 'ClassicPosition':
            return { entity: 'Classic', column: 'p.classic_id' };
        case 'ClmPosition':
            return { entity: 'Clm', column: 'p.clm_id' };
        default:
            throw new Error(`No catalog scope for ${from}`);
    }
};

export const sqlStringIn = (column: string, ids: readonly string[]) => {
    if (ids.length === 0) {
        return '0';
    }
    const literals = ids.map((id) => {
        if (!/^[\w.-]+$/.test(id)) {
            throw new Error(`Unexpected catalog id: ${id}`);
        }
        return `'${id}'`;
    });
    return `${column} IN (${literals.join(',')})`;
};

export const catalogIdsByEntity = (catalog: CatalogProduct[]): Map<IndexedEntity, string[]> => {
    const ids = new Map<IndexedEntity, string[]>(COVERAGE_ENTITIES.map((entity) => [entity, []]));
    for (const product of catalog) {
        ids.get(product.entity)?.push(product.id);
    }
    return ids;
};

const catalogPredicate = (from: string, idsByEntity: Map<IndexedEntity, readonly string[]>) => {
    const scope = catalogScope(from);
    return sqlStringIn(scope.column, idsByEntity.get(scope.entity) ?? []);
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

export const toScaled = (value: unknown): bigint => {
    if (value == null) {
        return 0n;
    }
    let raw = String(value).trim();
    if (raw === '') {
        return 0n;
    }
    let negative = false;
    if (raw.startsWith('-')) {
        negative = true;
        raw = raw.slice(1);
    }
    const scientific = raw.match(/^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
    if (scientific) {
        const digits = `${scientific[1] ?? ''}${scientific[2] ?? ''}` || '0';
        const exponent = Number(scientific[3] ?? '0') - (scientific[2]?.length ?? 0);
        const power = exponent + DECIMAL_SCALE;
        let scaled = BigInt(digits);
        if (power >= 0) {
            scaled *= 10n ** BigInt(power);
        } else if (power < -digits.length) {
            scaled = 0n;
        } else {
            scaled /= 10n ** BigInt(-power);
        }
        return negative ? -scaled : scaled;
    }
    const [whole, frac = ''] = raw.split('.');
    const fracFixed = `${frac}${'0'.repeat(DECIMAL_SCALE)}`.slice(0, DECIMAL_SCALE);
    const scaled = BigInt(whole || '0') * 10n ** BigInt(DECIMAL_SCALE) + BigInt(fracFixed || '0');
    return negative ? -scaled : scaled;
};

export const arrayLengthMismatch = (row: Record<string, unknown>, groups: readonly (readonly string[])[]) => {
    const problems: string[] = [];
    for (const fields of groups) {
        const lengths = fields.map((field) => (Array.isArray(row[field]) ? row[field].length : -1));
        if (new Set(lengths).size > 1) {
            problems.push(fields.map((field, index) => `${field}=${lengths[index]}`).join(' '));
        }
    }
    return problems;
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

        const extra: string[] = [];
        for (const id of indexed) {
            if (!expectedIds.has(id)) {
                extra.push(id);
            }
        }
        findings.push(
            finding('coverage', 'info', `${entity}.summary`, indexed.size, [
                `expected=${expectedForEntity.length} missingActive=${missingActive.length} missingEol=${missingEol.length} blacklisted=${expectedBlacklist.length} extra=${extra.length}`,
            ])
        );
        pushIfAny(
            findings,
            finding(
                'coverage',
                'error',
                `${entity}.missing-active`,
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

const lengthMismatch = (groups: readonly (readonly string[])[]) =>
    groups
        .map((fields) => {
            const [first, ...rest] = fields;
            return rest.map((field) => `length(t.${first}) != length(t.${field})`).join(' OR ');
        })
        .join(' OR ');

const runProbe = async (
    client: ClickHouseClient,
    probe: Probe,
    chainIds: number[],
    sampleSize: number,
    idsByEntity: Map<IndexedEntity, readonly string[]>
): Promise<{ count: number; sample: string[] }> => {
    const where = `${chainIn('t.chain_id', chainIds)} AND ${catalogPredicate(probe.from, idsByEntity)} AND (${probe.where})`;
    const [countRows, sampleRows] = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM ${probe.from} WHERE ${where}`),
        client.query<{ id: string }>(
            `SELECT t.id AS id FROM ${probe.from} WHERE ${where} ORDER BY t.id LIMIT ${sampleSize}`
        ),
    ]);
    return {
        count: Number(countRows[0]?.count ?? 0),
        sample: sampleRows.map((row) => row.id),
    };
};

const scanArrayAlignment = async (
    client: ClickHouseClient,
    chainIds: number[],
    sampleSize: number,
    idsByEntity: Map<IndexedEntity, readonly string[]>,
    log: (message: string) => void
): Promise<Finding[]> => {
    const findings: Finding[] = [];
    const scans = [
        { id: 'classic.array-alignment', from: 'Classic AS t', groups: CLASSIC_ARRAY_GROUPS },
        { id: 'clm.array-alignment', from: 'Clm AS t', groups: CLM_ARRAY_GROUPS },
    ] as const;
    for (const scan of scans) {
        log(`scanning ${scan.id}`);
        const hit = await runProbe(
            client,
            {
                id: scan.id,
                section: 'structure',
                severity: 'error',
                from: scan.from,
                where: lengthMismatch(scan.groups),
            },
            chainIds,
            sampleSize,
            idsByEntity
        );
        pushIfAny(findings, finding('structure', 'error', scan.id, hit.count, hit.sample));
    }
    return findings;
};

const arraySum = (column: string) => `arraySum(arrayMap(x -> toDecimal256OrZero(x, 24), ${column}))`;

const auditPositions = async (
    client: ClickHouseClient,
    chainIds: number[],
    sampleSize: number,
    idsByEntity: Map<IndexedEntity, readonly string[]>,
    log: (message: string) => void
): Promise<Finding[]> => {
    log('scanning position invariants');
    const chains = chainIn('p.chain_id', chainIds);
    const findings: Finding[] = [];
    const probes: Probe[] = [
        {
            id: 'classicPosition.reward-pool-alignment',
            section: 'structure',
            severity: 'error',
            from: 'ClassicPosition AS p INNER JOIN Classic AS c ON c.id = p.classic_id',
            where: 'length(p.reward_pool_balances) != length(c.reward_pool_tokens_order)',
        },
        {
            id: 'classicPosition.adapter-alignment',
            section: 'structure',
            severity: 'error',
            from: 'ClassicPosition AS p INNER JOIN Classic AS c ON c.id = p.classic_id',
            where: 'length(p.erc4626_adapter_balances) != length(c.erc4626_adapter_tokens_order) OR length(p.erc4626_adapter_vault_shares_balances) != length(c.erc4626_adapter_tokens_order)',
        },
        {
            id: 'classicPosition.total-balance',
            section: 'sanity',
            severity: 'warning',
            from: 'ClassicPosition AS p',
            where: `abs(${dec('p.total_balance')} - (${dec('p.vault_balance')} + ${dec('p.boost_balance')} + ${arraySum('p.reward_pool_balances')} + ${arraySum('p.erc4626_adapter_vault_shares_balances')})) > 0`,
        },
        {
            id: 'clmPosition.reward-pool-alignment',
            section: 'structure',
            severity: 'error',
            from: 'ClmPosition AS p INNER JOIN Clm AS c ON c.id = p.clm_id',
            where: 'length(p.reward_pool_balances) != length(c.reward_pool_tokens_order)',
        },
        {
            id: 'clmPosition.total-balance',
            section: 'sanity',
            severity: 'warning',
            from: 'ClmPosition AS p',
            where: `abs(${dec('p.total_balance')} - (${dec('p.manager_balance')} + ${arraySum('p.reward_pool_balances')})) > 0`,
        },
    ];
    for (const probe of probes) {
        const where = `${chains} AND ${catalogPredicate(probe.from, idsByEntity)} AND (${probe.where})`;
        const idColumn = probe.from.includes(' AS p') ? 'p.id' : 't.id';
        const [countRows, sampleRows] = await Promise.all([
            client.query<{ count: string }>(`SELECT count() AS count FROM ${probe.from} WHERE ${where}`),
            client.query<{ id: string }>(
                `SELECT ${idColumn} AS id FROM ${probe.from} WHERE ${where} ORDER BY ${idColumn} LIMIT ${sampleSize}`
            ),
        ]);
        pushIfAny(
            findings,
            finding(
                probe.section,
                probe.severity,
                probe.id,
                Number(countRows[0]?.count ?? 0),
                sampleRows.map((row) => row.id)
            )
        );
    }
    return findings;
};

const CLASSIC_SNAPSHOT_PAIRS = [
    ['s.vault_underlying_breakdown_balances', 'c.underlying_breakdown_tokens_order'],
    ['s.underlying_breakdown_to_native_prices', 'c.underlying_breakdown_tokens_order'],
    ['s.reward_pools_total_supply', 'c.reward_pool_tokens_order'],
    ['s.erc4626_adapters_total_supply', 'c.erc4626_adapter_tokens_order'],
    ['s.erc4626_adapter_vault_shares_balances', 'c.erc4626_adapter_tokens_order'],
    ['s.boost_reward_to_native_prices', 'c.boost_reward_tokens_order'],
    ['s.reward_to_native_prices', 'c.reward_tokens_order'],
] as const;

const CLM_SNAPSHOT_PAIRS = [
    ['s.reward_pools_total_supply', 'c.reward_pool_tokens_order'],
    ['s.output_to_native_prices', 'c.output_tokens_order'],
    ['s.reward_to_native_prices', 'c.reward_tokens_order'],
] as const;

const auditRecentSnapshots = async (
    client: ClickHouseClient,
    chainIds: number[],
    sampleSize: number,
    idsByEntity: Map<IndexedEntity, readonly string[]>,
    log: (message: string) => void
): Promise<Finding[]> => {
    log('checking recent hourly snapshots');
    const findings: Finding[] = [];
    const products = [
        {
            entity: 'Classic',
            snapshot: 'ClassicSnapshot',
            parentKey: 'classic_id',
            supply: 'vault_token_total_supply',
            pairs: CLASSIC_SNAPSHOT_PAIRS,
        },
        {
            entity: 'Clm',
            snapshot: 'ClmSnapshot',
            parentKey: 'clm_id',
            supply: 'manager_total_supply',
            pairs: CLM_SNAPSHOT_PAIRS,
        },
    ] as const;

    for (const product of products) {
        const missing: string[] = [];
        let misalignedCount = 0;
        const misalignedSample: string[] = [];
        for (const chainId of chainIds) {
            const latest = await client.query<{ latest: string }>(
                `SELECT toString(max(rounded_timestamp)) AS latest FROM ${product.snapshot} WHERE chain_id = ${chainId} AND period = '3600'`
            );
            const latestAt = latest[0]?.latest;
            const ours = sqlStringIn('id', idsByEntity.get(product.entity) ?? []);
            const active = await client.query<{ id: string }>(
                `SELECT id FROM ${product.entity} WHERE chain_id = ${chainId} AND ${ours} AND initializable_status = 'INITIALIZED' AND ${dec(product.supply)} > 0`
            );
            if (!latestAt || latestAt.startsWith('1970-')) {
                missing.push(...active.map((row) => row.id));
                continue;
            }
            const covered = await client.query<{ id: string }>(
                `SELECT DISTINCT ${product.parentKey} AS id FROM ${product.snapshot} WHERE chain_id = ${chainId} AND period = '3600' AND rounded_timestamp >= toDateTime64('${latestAt}', 3, 'UTC') - INTERVAL 2 HOUR`
            );
            const coveredIds = new Set(covered.map((row) => row.id));
            for (const row of active) {
                if (!coveredIds.has(row.id)) {
                    missing.push(row.id);
                }
            }
            const pairSql = product.pairs.map(([left, right]) => `length(${left}) != length(${right})`).join(' OR ');
            const snapshotWhere = `s.chain_id = ${chainId} AND ${sqlStringIn(`c.id`, idsByEntity.get(product.entity) ?? [])} AND s.period = '3600' AND s.rounded_timestamp >= toDateTime64('${latestAt}', 3, 'UTC') - INTERVAL 2 HOUR AND (${pairSql})`;
            const [badCount, bad] = await Promise.all([
                client.query<{ count: string }>(
                    `SELECT count() AS count FROM ${product.snapshot} AS s INNER JOIN ${product.entity} AS c ON c.id = s.${product.parentKey} WHERE ${snapshotWhere}`
                ),
                client.query<{ id: string }>(
                    `SELECT s.id AS id FROM ${product.snapshot} AS s INNER JOIN ${product.entity} AS c ON c.id = s.${product.parentKey} WHERE ${snapshotWhere} ORDER BY s.id LIMIT ${sampleSize}`
                ),
            ]);
            misalignedCount += Number(badCount[0]?.count ?? 0);
            for (const row of bad) {
                if (misalignedSample.length < sampleSize) {
                    misalignedSample.push(row.id);
                }
            }
        }
        pushIfAny(
            findings,
            finding(
                'sanity',
                'warning',
                `${product.entity}.missing-recent-snapshot`,
                missing.length,
                missing.slice(0, sampleSize)
            )
        );
        pushIfAny(
            findings,
            finding('structure', 'error', `${product.entity}.recent-snapshot-arrays`, misalignedCount, misalignedSample)
        );
    }
    return findings;
};

export type IntegrityOptions = {
    chainIds: number[];
    sampleSize: number;
    stuckThreshold: number;
    catalog: CatalogProduct[];
    indexedByEntity: Map<IndexedEntity, Set<string>>;
    blacklist: Set<string>;
    log?: (message: string) => void;
};

export const runIntegrityChecks = async (client: ClickHouseClient, options: IntegrityOptions): Promise<Finding[]> => {
    const log = options.log ?? (() => undefined);
    const { chainIds, sampleSize } = options;
    const idsByEntity = catalogIdsByEntity(options.catalog);
    const findings: Finding[] = [
        ...diffCoverage(options.catalog, options.indexedByEntity, options.blacklist, sampleSize),
    ];

    log('running structural and sanity probes');
    for (const probe of [...STRUCTURE_PROBES, ...SANITY_PROBES]) {
        const hit = await runProbe(client, probe, chainIds, sampleSize, idsByEntity);
        pushIfAny(findings, finding(probe.section, probe.severity, probe.id, hit.count, hit.sample));
    }

    const stuckSample: string[] = [];
    let stuckCount = 0;
    for (const entity of STUCK_ENTITIES) {
        const hit = await runProbe(
            client,
            {
                id: entity,
                section: 'structure',
                severity: 'warning',
                from: `${entity} AS t`,
                where: `t.initializable_status = 'INITIALIZING' AND t.initialized_timestamp < now64(3) - INTERVAL 24 HOUR`,
            },
            chainIds,
            sampleSize,
            idsByEntity
        );
        stuckCount += hit.count;
        for (const id of hit.sample) {
            if (stuckSample.length < sampleSize) {
                stuckSample.push(`${entity} ${id}`);
            }
        }
    }
    if (stuckCount > 0) {
        findings.push(
            finding(
                'structure',
                stuckCount > options.stuckThreshold ? 'error' : 'warning',
                'products.stuck-initializing',
                stuckCount,
                stuckSample
            )
        );
    }

    findings.push(...(await scanArrayAlignment(client, chainIds, sampleSize, idsByEntity, log)));
    findings.push(...(await auditPositions(client, chainIds, sampleSize, idsByEntity, log)));
    findings.push(...(await auditRecentSnapshots(client, chainIds, sampleSize, idsByEntity, log)));
    return findings;
};
