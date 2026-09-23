import { type CatalogProduct, COVERAGE_ENTITIES, type IndexedEntity } from './catalog';
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

export type Probe = {
    id: string;
    section: Section;
    severity: Severity;
    from: string;
    where: string;
};

const STUCK_ENTITIES = [
    'Classic',
    'Clm',
    'ClassicVault',
    'ClmManager',
    'ClassicVaultStrategy',
    'ClmStrategy',
    'ClassicBoost',
    'ClassicErc4626Adapter',
    'RewardPool',
    'LstVault',
] as const;

const DECIMAL_SCALE = 24;

/** TokenBalanceChange.block_number is a string; lexicographic argMax prefers 7-digit blocks over later 8-digit ones. */
export const changeBlockSeq = (alias = 't') =>
    `(toUInt64(${alias}.block_number), ${alias}.trx_index, ${alias}.log_index)`;

const initialized = `t.initializable_status = 'INITIALIZED'`;
const blank = (column: string, alias = 't') => `(${alias}.${column} IS NULL OR ${alias}.${column} = '')`;
const dec = (column: string) => `toDecimal256OrZero(${column}, 24)`;

/**
 * Uniswap ConcLiq: balances() = idle + main + alt - locked - min(fees, max(gross, 0)).
 * Velodrome has no fees0/lockedProfit; those calls store 0 and idle is already net of fees.
 */
export const clmAmountIdentitySql = (side: '0' | '1') => {
    const total = dec(`t.total_underlying_amount${side}`);
    const idle = dec(`t.underlying_idle_amount${side}`);
    const main = dec(`t.underlying_main_amount${side}`);
    const alt = dec(`t.underlying_alt_amount${side}`);
    const locked = dec(`t.underlying_locked_amount${side}`);
    const fees = dec(`t.underlying_unharvested_fees${side}`);
    const gross = `(${idle} + ${main} + ${alt} - ${locked})`;
    const expected = `(${gross} - least(${fees}, greatest(${gross}, 0)))`;
    return `abs(${total} - ${expected}) > 0`;
};

const missingField = (table: string, column: string, id: string): Probe => ({
    id,
    section: 'structure',
    severity: 'error',
    from: `${table} AS t`,
    where: `${initialized} AND ${blank(column)}`,
});

const blankField = (table: string, column: string, id: string): Probe => ({
    id,
    section: 'structure',
    severity: 'error',
    from: `${table} AS t`,
    where: blank(column),
});

const nullMetadata = (table: string, tokenColumn: string, id: string): Probe => ({
    id,
    section: 'structure',
    severity: 'error',
    from: `${table} AS t LEFT JOIN Token AS token ON token.id = t.${tokenColumn}`,
    where: `${initialized} AND (token.id IS NULL OR token.symbol IS NULL OR token.symbol = '' OR token.name IS NULL OR token.name = '')`,
});

/** Boost share tokens are virtual; vault/manager/LST/adapter shares are real ERC20s. */
const virtualFlag = (table: string, tokenColumn: string, expectedVirtual: boolean, id: string): Probe => ({
    id,
    section: 'structure',
    severity: 'error',
    from: `${table} AS t LEFT JOIN Token AS token ON token.id = t.${tokenColumn}`,
    where: `${initialized} AND token.id IS NOT NULL AND toUInt8(token.is_virtual) = ${expectedVirtual ? 0 : 1}`,
});

const zeroDecimals = (table: string, tokenColumn: string, id: string): Probe => ({
    id,
    section: 'sanity',
    severity: 'warning',
    from: `${table} AS t LEFT JOIN Token AS token ON token.id = t.${tokenColumn}`,
    where: `${initialized} AND token.id IS NOT NULL AND token.decimals = 0`,
});

/** Hard failures: incomplete INITIALIZED graphs and tokens without metadata. */
export const STRUCTURE_PROBES: Probe[] = [
    missingField('Classic', 'classic_vault_id', 'classic.missing-vault'),
    missingField('Classic', 'classic_vault_strategy_id', 'classic.missing-strategy'),
    missingField('Clm', 'clm_manager_id', 'clm.missing-manager'),
    missingField('Clm', 'clm_strategy_id', 'clm.missing-strategy'),
    missingField('ClassicVault', 'classic_id', 'classicVault.missing-aggregate'),
    missingField('ClmManager', 'clm_id', 'clmManager.missing-aggregate'),
    missingField('ClassicBoost', 'classic_id', 'classicBoost.missing-aggregate'),
    missingField('ClassicErc4626Adapter', 'classic_id', 'erc4626Adapter.missing-aggregate'),
    missingField('ClassicVaultStrategy', 'classic_vault_id', 'classicVaultStrategy.missing-vault'),
    missingField('ClmStrategy', 'clm_manager_id', 'clmStrategy.missing-manager'),
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
    missingField('ClmManager', 'share_token_id', 'clmManager.missing-share-token'),
    missingField('ClmManager', 'underlying_token0_id', 'clmManager.missing-token0'),
    missingField('ClmManager', 'underlying_token1_id', 'clmManager.missing-token1'),
    missingField('ClassicBoost', 'share_token_id', 'classicBoost.missing-share-token'),
    missingField('ClassicBoost', 'underlying_token_id', 'classicBoost.missing-underlying-token'),
    missingField('ClassicBoost', 'reward_token_id', 'classicBoost.missing-reward-token'),
    missingField('ClassicErc4626Adapter', 'share_token_id', 'erc4626Adapter.missing-share-token'),
    missingField('ClassicErc4626Adapter', 'underlying_token_id', 'erc4626Adapter.missing-underlying-token'),
    missingField('RewardPool', 'share_token_id', 'rewardPool.missing-share-token'),
    missingField('RewardPool', 'underlying_token_id', 'rewardPool.missing-underlying-token'),
    missingField('LstVault', 'share_token_id', 'lstVault.missing-share-token'),
    missingField('LstVault', 'underlying_token_id', 'lstVault.missing-underlying-token'),
    blankField('SwapperRoute', 'swapper_id', 'swapperRoute.missing-swapper'),
    blankField('SwapperRoute', 'from_token_id', 'swapperRoute.missing-from-token'),
    blankField('SwapperRoute', 'to_token_id', 'swapperRoute.missing-to-token'),
    nullMetadata('Classic', 'vault_token_id', 'classic.vault-token-metadata'),
    nullMetadata('Classic', 'underlying_token_id', 'classic.underlying-token-metadata'),
    nullMetadata('Clm', 'manager_token_id', 'clm.manager-token-metadata'),
    nullMetadata('Clm', 'underlying_token0_id', 'clm.token0-metadata'),
    nullMetadata('Clm', 'underlying_token1_id', 'clm.token1-metadata'),
    nullMetadata('ClassicVault', 'share_token_id', 'classicVault.share-token-metadata'),
    nullMetadata('ClassicVault', 'underlying_token_id', 'classicVault.underlying-token-metadata'),
    nullMetadata('ClmManager', 'share_token_id', 'clmManager.share-token-metadata'),
    nullMetadata('ClmManager', 'underlying_token0_id', 'clmManager.token0-metadata'),
    nullMetadata('ClmManager', 'underlying_token1_id', 'clmManager.token1-metadata'),
    nullMetadata('ClassicBoost', 'share_token_id', 'classicBoost.share-token-metadata'),
    nullMetadata('ClassicBoost', 'underlying_token_id', 'classicBoost.underlying-token-metadata'),
    nullMetadata('ClassicBoost', 'reward_token_id', 'classicBoost.reward-token-metadata'),
    nullMetadata('ClassicErc4626Adapter', 'share_token_id', 'erc4626Adapter.share-token-metadata'),
    nullMetadata('RewardPool', 'share_token_id', 'rewardPool.share-token-metadata'),
    nullMetadata('LstVault', 'share_token_id', 'lstVault.share-token-metadata'),
    nullMetadata('LstVault', 'underlying_token_id', 'lstVault.underlying-token-metadata'),
    virtualFlag('ClassicBoost', 'share_token_id', true, 'classicBoost.share-token-not-virtual'),
    virtualFlag('ClassicVault', 'share_token_id', false, 'classicVault.share-token-virtual'),
    virtualFlag('ClmManager', 'share_token_id', false, 'clmManager.share-token-virtual'),
    virtualFlag('LstVault', 'share_token_id', false, 'lstVault.share-token-virtual'),
    virtualFlag('ClassicErc4626Adapter', 'share_token_id', false, 'erc4626Adapter.share-token-virtual'),
    virtualFlag('RewardPool', 'share_token_id', false, 'rewardPool.share-token-virtual'),
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
        id: 'clm.zero-token0-price',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t',
        where: `${initialized} AND ${positiveSupply('manager_total_supply')} AND ${zeroPrice('token0_to_native_price')}`,
    },
    {
        id: 'clm.zero-token1-price',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t',
        where: `${initialized} AND ${positiveSupply('manager_total_supply')} AND ${zeroPrice('token1_to_native_price')}`,
    },
    {
        id: 'clm.zero-protocol-pool',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t',
        where: `${initialized} AND hex(t.underlying_protocol_pool) IN ('', '0000000000000000000000000000000000000000')`,
    },
    {
        id: 'clm.inverted-price-range',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t',
        where: `${initialized} AND ${positiveSupply('manager_total_supply')} AND ${dec('t.price_range_min1')} > ${dec('t.price_range_max1')}`,
    },
    /** `balances()` = balancesOfThis + main + alt - lockedProfit - clamped unharvested fees. */
    {
        id: 'clm.amount0-identity',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t',
        where: `${initialized} AND ${clmAmountIdentitySql('0')}`,
    },
    {
        id: 'clm.amount1-identity',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t',
        where: `${initialized} AND ${clmAmountIdentitySql('1')}`,
    },
    zeroDecimals('Classic', 'vault_token_id', 'classic.vault-token-decimals'),
    zeroDecimals('Classic', 'underlying_token_id', 'classic.underlying-token-decimals'),
    zeroDecimals('Clm', 'manager_token_id', 'clm.manager-token-decimals'),
    zeroDecimals('Clm', 'underlying_token0_id', 'clm.token0-decimals'),
    zeroDecimals('Clm', 'underlying_token1_id', 'clm.token1-decimals'),
    zeroDecimals('LstVault', 'share_token_id', 'lstVault.share-token-decimals'),
    zeroDecimals('ClassicBoost', 'share_token_id', 'classicBoost.share-token-decimals'),
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

const firstAlias = (from: string) => from.match(/\bAS (\w+)/)?.[1] ?? 't';

/**
 * Permissionless factories index products Beefy does not list. Structure and sanity
 * checks only apply to catalog ids (API products, plus configured LST vaults and swappers).
 * ClassicVault shares the Classic vault address; ClmManager shares the Clm manager address.
 */
export const catalogScope = (from: string): { entity: IndexedEntity; column: string } => {
    const alias = firstAlias(from);
    switch (from.split(' ')[0]) {
        case 'Classic':
        case 'ClassicVault':
            return { entity: 'Classic', column: `${alias}.id` };
        case 'Clm':
        case 'ClmManager':
            return { entity: 'Clm', column: `${alias}.id` };
        case 'ClassicBoost':
            return { entity: 'ClassicBoost', column: `${alias}.id` };
        case 'RewardPool':
            return { entity: 'RewardPool', column: `${alias}.id` };
        case 'LstVault':
            return { entity: 'LstVault', column: `${alias}.id` };
        case 'Swapper':
            return { entity: 'Swapper', column: `${alias}.id` };
        case 'SwapperRoute':
            return { entity: 'Swapper', column: `${alias}.swapper_id` };
        case 'ClassicErc4626Adapter':
            return { entity: 'Classic', column: `${alias}.classic_id` };
        case 'ClassicVaultStrategy':
            return { entity: 'Classic', column: `${alias}.classic_vault_id` };
        case 'ClmStrategy':
            return { entity: 'Clm', column: `${alias}.clm_manager_id` };
        case 'ClassicPosition':
        case 'ClassicHarvestEvent':
        case 'ClassicPositionInteraction':
            return { entity: 'Classic', column: `${alias}.classic_id` };
        case 'ClmPosition':
        case 'ClmHarvestEvent':
        case 'ClmPositionInteraction':
            return { entity: 'Clm', column: `${alias}.clm_id` };
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
        if (entity === 'Swapper') {
            pushIfAny(
                findings,
                finding(
                    'coverage',
                    'warning',
                    'Swapper.missing-configured',
                    missingActive.length,
                    missingActive.slice(0, sampleSize)
                )
            );
        } else {
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
        }
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

export const lengthMismatchSql = (groups: readonly (readonly string[])[], alias = 't') =>
    groups
        .map((fields) => {
            const [first, ...rest] = fields;
            return rest.map((field) => `length(${alias}.${first}) != length(${alias}.${field})`).join(' OR ');
        })
        .join(' OR ');

export const rewardPoolListedSql = (parentAlias: string, poolAlias = 't') =>
    `NOT has(${parentAlias}.reward_pool_token_ids, ${poolAlias}.share_token_id)`;

const runProbe = async (
    client: ClickHouseClient,
    probe: Probe,
    chainIds: number[],
    sampleSize: number,
    idsByEntity: Map<IndexedEntity, readonly string[]>
): Promise<{ count: number; sample: string[] }> => {
    const alias = firstAlias(probe.from);
    const where = `${chainIn(`${alias}.chain_id`, chainIds)} AND ${catalogPredicate(probe.from, idsByEntity)} AND (${probe.where})`;
    const [countRows, sampleRows] = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM ${probe.from} WHERE ${where}`),
        client.query<{ id: string }>(
            `SELECT ${alias}.id AS id FROM ${probe.from} WHERE ${where} ORDER BY ${alias}.id LIMIT ${sampleSize}`
        ),
    ]);
    return {
        count: Number(countRows[0]?.count ?? 0),
        sample: sampleRows.map((row) => row.id),
    };
};

const runProbes = async (
    client: ClickHouseClient,
    probes: readonly Probe[],
    chainIds: number[],
    sampleSize: number,
    idsByEntity: Map<IndexedEntity, readonly string[]>,
    findings: Finding[]
) => {
    for (const probe of probes) {
        const hit = await runProbe(client, probe, chainIds, sampleSize, idsByEntity);
        pushIfAny(findings, finding(probe.section, probe.severity, probe.id, hit.count, hit.sample));
    }
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
                where: lengthMismatchSql(scan.groups),
            },
            chainIds,
            sampleSize,
            idsByEntity
        );
        pushIfAny(findings, finding('structure', 'error', scan.id, hit.count, hit.sample));
    }
    return findings;
};

export const GRAPH_PROBES: Probe[] = [
    {
        id: 'classic.bidirectional-vault',
        section: 'structure',
        severity: 'error',
        from: 'Classic AS t INNER JOIN ClassicVault AS v ON v.id = t.id',
        where: `${initialized} AND (t.classic_vault_id != t.id OR v.id != t.id OR v.classic_id != t.id)`,
    },
    {
        id: 'classic.token-identity',
        section: 'structure',
        severity: 'error',
        from: 'Classic AS t INNER JOIN ClassicVault AS v ON v.id = t.classic_vault_id',
        where: `${initialized} AND (t.vault_token_id != v.share_token_id OR t.underlying_token_id != v.underlying_token_id)`,
    },
    {
        id: 'clm.bidirectional-manager',
        section: 'structure',
        severity: 'error',
        from: 'Clm AS t INNER JOIN ClmManager AS m ON m.id = t.id',
        where: `${initialized} AND (t.clm_manager_id != t.id OR m.id != t.id OR m.clm_id != t.id)`,
    },
    {
        id: 'clm.token-identity',
        section: 'structure',
        severity: 'error',
        from: 'Clm AS t INNER JOIN ClmManager AS m ON m.id = t.clm_manager_id',
        where: `${initialized} AND (t.manager_token_id != m.share_token_id OR t.underlying_token0_id != m.underlying_token0_id OR t.underlying_token1_id != m.underlying_token1_id)`,
    },
    {
        id: 'classicBoost.underlying-mismatch',
        section: 'structure',
        severity: 'error',
        from: 'ClassicBoost AS t INNER JOIN Classic AS c ON c.id = t.classic_id',
        where: `${initialized} AND t.underlying_token_id != c.vault_token_id`,
    },
    {
        id: 'erc4626Adapter.underlying-mismatch',
        section: 'structure',
        severity: 'error',
        from: 'ClassicErc4626Adapter AS t INNER JOIN Classic AS c ON c.id = t.classic_id',
        where: `${initialized} AND t.underlying_token_id != c.vault_token_id`,
    },
    {
        id: 'rewardPool.classic-underlying-mismatch',
        section: 'structure',
        severity: 'error',
        from: 'RewardPool AS t INNER JOIN Classic AS c ON c.id = t.classic_id',
        where: `${initialized} AND t.underlying_token_id != c.vault_token_id`,
    },
    {
        id: 'rewardPool.clm-underlying-mismatch',
        section: 'structure',
        severity: 'error',
        from: 'RewardPool AS t INNER JOIN Clm AS c ON c.id = t.clm_id',
        where: `${initialized} AND t.underlying_token_id != c.manager_token_id`,
    },
    {
        id: 'rewardPool.classic-not-listed',
        section: 'structure',
        severity: 'error',
        from: 'RewardPool AS t INNER JOIN Classic AS c ON c.id = t.classic_id',
        where: `${initialized} AND ${rewardPoolListedSql('c')}`,
    },
    {
        id: 'rewardPool.clm-not-listed',
        section: 'structure',
        severity: 'error',
        from: 'RewardPool AS t INNER JOIN Clm AS c ON c.id = t.clm_id',
        where: `${initialized} AND ${rewardPoolListedSql('c')}`,
    },
];

const arraySum = (column: string) => `arraySum(arrayMap(x -> toDecimal256OrZero(x, 24), ${column}))`;

const POSITION_PROBES: Probe[] = [
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
        id: 'classicPosition.negative-balance',
        section: 'sanity',
        severity: 'warning',
        from: 'ClassicPosition AS p',
        where: `${dec('p.total_balance')} < 0`,
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
    {
        id: 'clmPosition.negative-balance',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmPosition AS p',
        where: `${dec('p.total_balance')} < 0`,
    },
];

const pairMismatch = (pairs: readonly (readonly [string, string])[]) =>
    pairs.map(([left, right]) => `length(${left}) != length(${right})`).join(' OR ');

const CLASSIC_HARVEST_PAIRS = [
    ['t.reward_pools_total_supply', 'c.reward_pool_tokens_order'],
    ['t.boost_reward_to_native_prices', 'c.boost_reward_tokens_order'],
    ['t.reward_to_native_prices', 'c.reward_tokens_order'],
] as const;

const CLM_HARVEST_PAIRS = [
    ['t.reward_pools_total_supply', 'c.reward_pool_tokens_order'],
    ['t.collected_output_amounts', 'c.output_tokens_order'],
    ['t.output_to_native_prices', 'c.output_tokens_order'],
    ['t.reward_to_native_prices', 'c.reward_tokens_order'],
] as const;

const CLASSIC_INTERACTION_PAIRS = [
    ['t.reward_pool_balances', 'c.reward_pool_tokens_order'],
    ['t.erc4626_adapter_balances', 'c.erc4626_adapter_tokens_order'],
    ['t.erc4626_adapter_vault_shares_balances', 'c.erc4626_adapter_tokens_order'],
    ['t.vault_underlying_breakdown_balances', 'c.underlying_breakdown_tokens_order'],
    ['t.reward_pool_balances_delta', 'c.reward_pool_tokens_order'],
    ['t.reward_balances_delta', 'c.reward_tokens_order'],
    ['t.boost_reward_balances_delta', 'c.boost_reward_tokens_order'],
    ['t.erc4626_adapter_balances_delta', 'c.erc4626_adapter_tokens_order'],
    ['t.erc4626_adapter_vault_shares_balances_delta', 'c.erc4626_adapter_tokens_order'],
    ['t.underlying_breakdown_to_native_prices', 'c.underlying_breakdown_tokens_order'],
    ['t.boost_reward_to_native_prices', 'c.boost_reward_tokens_order'],
    ['t.reward_to_native_prices', 'c.reward_tokens_order'],
] as const;

const CLM_INTERACTION_PAIRS = [
    ['t.reward_pool_balances', 'c.reward_pool_tokens_order'],
    ['t.reward_pool_balances_delta', 'c.reward_pool_tokens_order'],
    ['t.reward_balances_delta', 'c.reward_tokens_order'],
    ['t.output_to_native_prices', 'c.output_tokens_order'],
    ['t.reward_to_native_prices', 'c.reward_tokens_order'],
] as const;

export const EVENT_PROBES: Probe[] = [
    blankField('ClassicHarvestEvent', 'classic_id', 'classicHarvest.missing-classic'),
    blankField('ClassicHarvestEvent', 'classic_vault_strategy_id', 'classicHarvest.missing-strategy'),
    blankField('ClmHarvestEvent', 'clm_id', 'clmHarvest.missing-clm'),
    blankField('ClmHarvestEvent', 'clm_strategy_id', 'clmHarvest.missing-strategy'),
    blankField('ClassicPositionInteraction', 'classic_id', 'classicInteraction.missing-classic'),
    blankField('ClassicPositionInteraction', 'account_id', 'classicInteraction.missing-account'),
    blankField('ClassicPositionInteraction', 'classic_position_id', 'classicInteraction.missing-position'),
    blankField('ClmPositionInteraction', 'clm_id', 'clmInteraction.missing-clm'),
    blankField('ClmPositionInteraction', 'account_id', 'clmInteraction.missing-account'),
    blankField('ClmPositionInteraction', 'clm_position_id', 'clmInteraction.missing-position'),
    {
        id: 'classicHarvest.array-alignment',
        section: 'structure',
        severity: 'error',
        from: 'ClassicHarvestEvent AS t INNER JOIN Classic AS c ON c.id = t.classic_id',
        where: pairMismatch(CLASSIC_HARVEST_PAIRS),
    },
    {
        id: 'clmHarvest.array-alignment',
        section: 'structure',
        severity: 'error',
        from: 'ClmHarvestEvent AS t INNER JOIN Clm AS c ON c.id = t.clm_id',
        where: pairMismatch(CLM_HARVEST_PAIRS),
    },
    {
        id: 'classicInteraction.array-alignment',
        section: 'structure',
        severity: 'error',
        from: 'ClassicPositionInteraction AS t INNER JOIN Classic AS c ON c.id = t.classic_id',
        where: pairMismatch(CLASSIC_INTERACTION_PAIRS),
    },
    {
        id: 'clmInteraction.array-alignment',
        section: 'structure',
        severity: 'error',
        from: 'ClmPositionInteraction AS t INNER JOIN Clm AS c ON c.id = t.clm_id',
        where: pairMismatch(CLM_INTERACTION_PAIRS),
    },
    {
        id: 'classicInteraction.total-balance',
        section: 'sanity',
        severity: 'warning',
        from: 'ClassicPositionInteraction AS t',
        where: `abs(${dec('t.total_balance')} - (${dec('t.vault_balance')} + ${dec('t.boost_balance')} + ${arraySum('t.reward_pool_balances')} + ${arraySum('t.erc4626_adapter_vault_shares_balances')})) > 0`,
    },
    {
        id: 'clmInteraction.total-balance',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmPositionInteraction AS t',
        where: `abs(${dec('t.total_balance')} - (${dec('t.manager_balance')} + ${arraySum('t.reward_pool_balances')})) > 0`,
    },
];

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
            entity: 'Classic' as const,
            snapshot: 'ClassicSnapshot',
            parentKey: 'classic_id',
            supply: 'vault_token_total_supply',
            pairs: CLASSIC_SNAPSHOT_PAIRS,
        },
        {
            entity: 'Clm' as const,
            snapshot: 'ClmSnapshot',
            parentKey: 'clm_id',
            supply: 'manager_total_supply',
            pairs: CLM_SNAPSHOT_PAIRS,
        },
    ];

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
            const snapshotWhere = `s.chain_id = ${chainId} AND ${sqlStringIn(`c.id`, idsByEntity.get(product.entity) ?? [])} AND s.period = '3600' AND s.rounded_timestamp >= toDateTime64('${latestAt}', 3, 'UTC') - INTERVAL 2 HOUR AND (${pairMismatch(product.pairs)})`;
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

const auditClockTicks = async (
    client: ClickHouseClient,
    chainIds: number[],
    sampleSize: number,
    log: (message: string) => void
): Promise<Finding[]> => {
    log('checking hourly clock ticks');
    const stale: string[] = [];
    for (const chainId of chainIds) {
        const latest = await client.query<{ latest: string }>(
            `SELECT toString(max(rounded_timestamp)) AS latest FROM ClockTick WHERE chain_id = ${chainId} AND period = '3600'`
        );
        const latestAt = latest[0]?.latest;
        if (!latestAt || latestAt.startsWith('1970-')) {
            stale.push(String(chainId));
            continue;
        }
        const fresh = await client.query<{ count: string }>(
            `SELECT count() AS count FROM ClockTick WHERE chain_id = ${chainId} AND period = '3600' AND rounded_timestamp >= now64(3) - INTERVAL 2 HOUR`
        );
        if (Number(fresh[0]?.count ?? 0) === 0) {
            stale.push(`${chainId} last=${latestAt}`);
        }
    }
    const findings: Finding[] = [];
    pushIfAny(
        findings,
        finding('sanity', 'warning', 'clockTick.stale-hourly', stale.length, stale.slice(0, sampleSize))
    );
    return findings;
};

const SHARE_TOKEN_SOURCES = [
    { table: 'Classic', column: 'vault_token_id' },
    { table: 'Clm', column: 'manager_token_id' },
    { table: 'ClassicBoost', column: 'share_token_id' },
    { table: 'RewardPool', column: 'share_token_id' },
    { table: 'LstVault', column: 'share_token_id' },
    { table: 'ClassicErc4626Adapter', column: 'share_token_id' },
] as const;

const collectShareTokenIds = async (
    client: ClickHouseClient,
    chainIds: number[],
    idsByEntity: Map<IndexedEntity, readonly string[]>
): Promise<string[]> => {
    const ids = new Set<string>();
    for (const source of SHARE_TOKEN_SOURCES) {
        const from = `${source.table} AS t`;
        const rows = await client.query<{ id: string }>(
            `SELECT DISTINCT t.${source.column} AS id FROM ${from} WHERE ${chainIn('t.chain_id', chainIds)} AND ${catalogPredicate(from, idsByEntity)} AND ${initialized} AND NOT ${blank(source.column)}`
        );
        for (const row of rows) {
            if (row.id) {
                ids.add(row.id);
            }
        }
    }
    return [...ids];
};

const auditLedger = async (
    client: ClickHouseClient,
    chainIds: number[],
    sampleSize: number,
    idsByEntity: Map<IndexedEntity, readonly string[]>,
    log: (message: string) => void
): Promise<Finding[]> => {
    log('checking token balance ledger');
    const findings: Finding[] = [];
    const tokenIds = await collectShareTokenIds(client, chainIds, idsByEntity);
    const tokens = sqlStringIn('tb.token_id', tokenIds);
    const changeTokens = sqlStringIn('t.token_id', tokenIds);
    const chains = chainIn('tb.chain_id', chainIds);

    const negative = await Promise.all([
        client.query<{ count: string }>(
            `SELECT count() AS count FROM TokenBalance AS tb WHERE ${chains} AND ${tokens} AND ${dec('tb.amount')} < 0`
        ),
        client.query<{ id: string }>(
            `SELECT tb.id AS id FROM TokenBalance AS tb WHERE ${chains} AND ${tokens} AND ${dec('tb.amount')} < 0 ORDER BY tb.id LIMIT ${sampleSize}`
        ),
    ]);
    pushIfAny(
        findings,
        finding(
            'sanity',
            'warning',
            'tokenBalance.negative-amount',
            Number(negative[0][0]?.count ?? 0),
            negative[1].map((row) => row.id)
        )
    );

    const driftWhere = `${chains} AND ${tokens} AND ${dec('tb.amount')} != ${dec('ch.last_after')}`;
    const driftFrom = `TokenBalance AS tb INNER JOIN (SELECT token_balance_id, argMax(balance_after, ${changeBlockSeq('t')}) AS last_after FROM TokenBalanceChange AS t WHERE ${chainIn('t.chain_id', chainIds)} AND ${changeTokens} GROUP BY token_balance_id) AS ch ON ch.token_balance_id = tb.id`;
    const drift = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM ${driftFrom} WHERE ${driftWhere}`),
        client.query<{ id: string }>(
            `SELECT tb.id AS id FROM ${driftFrom} WHERE ${driftWhere} ORDER BY tb.id LIMIT ${sampleSize}`
        ),
    ]);
    pushIfAny(
        findings,
        finding(
            'sanity',
            'warning',
            'tokenBalance.change-mismatch',
            Number(drift[0][0]?.count ?? 0),
            drift[1].map((row) => row.id)
        )
    );

    const fkWhere = `${chainIn('t.chain_id', chainIds)} AND ${changeTokens} AND (${blank('token_balance_id')} OR ${blank('account_id')} OR ${blank('token_id')})`;
    const fks = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM TokenBalanceChange AS t WHERE ${fkWhere}`),
        client.query<{ id: string }>(
            `SELECT t.id AS id FROM TokenBalanceChange AS t WHERE ${fkWhere} ORDER BY t.id LIMIT ${sampleSize}`
        ),
    ]);
    pushIfAny(
        findings,
        finding(
            'structure',
            'error',
            'tokenBalanceChange.missing-fk',
            Number(fks[0][0]?.count ?? 0),
            fks[1].map((row) => row.id)
        )
    );
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
    await runProbes(client, [...STRUCTURE_PROBES, ...SANITY_PROBES], chainIds, sampleSize, idsByEntity, findings);

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
    log('scanning product graph');
    await runProbes(client, GRAPH_PROBES, chainIds, sampleSize, idsByEntity, findings);
    log('scanning position invariants');
    await runProbes(client, POSITION_PROBES, chainIds, sampleSize, idsByEntity, findings);
    findings.push(...(await auditRecentSnapshots(client, chainIds, sampleSize, idsByEntity, log)));
    log('scanning harvest and interaction events');
    await runProbes(client, EVENT_PROBES, chainIds, sampleSize, idsByEntity, findings);
    findings.push(...(await auditClockTicks(client, chainIds, sampleSize, log)));
    findings.push(...(await auditLedger(client, chainIds, sampleSize, idsByEntity, log)));
    return findings;
};
