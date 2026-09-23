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
export const clmAmountIdentitySql = (side: '0' | '1', alias = 't') => {
    const total = dec(`${alias}.total_underlying_amount${side}`);
    const idle = dec(`${alias}.underlying_idle_amount${side}`);
    const main = dec(`${alias}.underlying_main_amount${side}`);
    const alt = dec(`${alias}.underlying_alt_amount${side}`);
    const locked = dec(`${alias}.underlying_locked_amount${side}`);
    const fees = dec(`${alias}.underlying_unharvested_fees${side}`);
    const gross = `(${idle} + ${main} + ${alt} - ${locked})`;
    const expected = `(${gross} - least(${fees}, greatest(${gross}, 0)))`;
    return `abs(${total} - ${expected}) > 0`;
};

/**
 * BeefyVaultConcLiq mints MINIMUM_SHARES (1000 wei) to 0xdead on first deposit.
 * Token.totalSupply treats mint-to-dead as circulating-supply wash, so allow that dust.
 */
export const CLM_LOCKED_MINIMUM_SHARES = 1000;

export const clmShareSupplyMismatchSql = (alias = 't', tokenAlias = 'token') =>
    `abs(${dec(`${alias}.manager_total_supply`)} - ${dec(`${tokenAlias}.total_supply`)}) > toDecimal256(${CLM_LOCKED_MINIMUM_SHARES}, ${DECIMAL_SCALE}) / toDecimal256(intExp10(toUInt8(${tokenAlias}.decimals)), ${DECIMAL_SCALE})`;

/** Product ids are `${chainId}-0x${lowercaseHex(address)}`. Address columns are raw bytes. */
export const productIdMismatchSql = (alias = 't') =>
    `${alias}.id != concat(toString(${alias}.chain_id), '-0x', lower(hex(${alias}.address)))`;

export const tokenIdMismatchSql = (alias = 'token') => productIdMismatchSql(alias);

export const accountIdMismatchSql = (alias = 't') => `${alias}.id != concat('0x', lower(hex(${alias}.address)))`;

/** Parallel `*_token_ids` should be `chainId-` + the matching `*_tokens_order` address. */
export const tokenIdsOrderMismatchSql = (idsColumn: string, orderColumn: string, alias = 't') =>
    `arrayExists((id, addr) -> id != concat(toString(${alias}.chain_id), '-', addr), ${alias}.${idsColumn}, ${alias}.${orderColumn})`;

const negativeCol = (column: string, alias = 't') => `${dec(`${alias}.${column}`)} < 0`;
const arrayHasNegative = (column: string, alias = 't') =>
    `arrayExists(x -> toDecimal256OrZero(x, 24) < 0, ${alias}.${column})`;
const zeroAddress = (column: string, alias = 't') =>
    `hex(${alias}.${column}) IN ('', '0000000000000000000000000000000000000000')`;

export const SNAPSHOT_PERIODS = ['3600', '86400', '604800'] as const;
export const CLOCK_TICK_PERIOD = '3600';

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
    blankField('SwapperRoute', 'router', 'swapperRoute.missing-router'),
    blankField('SwapperRoute', 'data', 'swapperRoute.missing-data'),
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
    nullMetadata('ClassicErc4626Adapter', 'underlying_token_id', 'erc4626Adapter.underlying-token-metadata'),
    nullMetadata('RewardPool', 'share_token_id', 'rewardPool.share-token-metadata'),
    nullMetadata('RewardPool', 'underlying_token_id', 'rewardPool.underlying-token-metadata'),
    nullMetadata('LstVault', 'share_token_id', 'lstVault.share-token-metadata'),
    nullMetadata('LstVault', 'underlying_token_id', 'lstVault.underlying-token-metadata'),
    virtualFlag('ClassicBoost', 'share_token_id', true, 'classicBoost.share-token-not-virtual'),
    virtualFlag('ClassicVault', 'share_token_id', false, 'classicVault.share-token-virtual'),
    virtualFlag('ClmManager', 'share_token_id', false, 'clmManager.share-token-virtual'),
    virtualFlag('LstVault', 'share_token_id', false, 'lstVault.share-token-virtual'),
    virtualFlag('ClassicErc4626Adapter', 'share_token_id', false, 'erc4626Adapter.share-token-virtual'),
    virtualFlag('RewardPool', 'share_token_id', false, 'rewardPool.share-token-virtual'),
    {
        id: 'classic.id-address',
        section: 'structure',
        severity: 'error',
        from: 'Classic AS t',
        where: `${initialized} AND ${productIdMismatchSql()}`,
    },
    {
        id: 'clm.id-address',
        section: 'structure',
        severity: 'error',
        from: 'Clm AS t',
        where: `${initialized} AND ${productIdMismatchSql()}`,
    },
    {
        id: 'classicVault.id-address',
        section: 'structure',
        severity: 'error',
        from: 'ClassicVault AS t',
        where: `${initialized} AND ${productIdMismatchSql()}`,
    },
    {
        id: 'clmManager.id-address',
        section: 'structure',
        severity: 'error',
        from: 'ClmManager AS t',
        where: `${initialized} AND ${productIdMismatchSql()}`,
    },
    {
        id: 'classicBoost.id-address',
        section: 'structure',
        severity: 'error',
        from: 'ClassicBoost AS t',
        where: `${initialized} AND ${productIdMismatchSql()}`,
    },
    {
        id: 'erc4626Adapter.id-address',
        section: 'structure',
        severity: 'error',
        from: 'ClassicErc4626Adapter AS t',
        where: `${initialized} AND ${productIdMismatchSql()}`,
    },
    {
        id: 'rewardPool.id-address',
        section: 'structure',
        severity: 'error',
        from: 'RewardPool AS t',
        where: `${initialized} AND ${productIdMismatchSql()}`,
    },
    {
        id: 'lstVault.id-address',
        section: 'structure',
        severity: 'error',
        from: 'LstVault AS t',
        where: `${initialized} AND ${productIdMismatchSql()}`,
    },
    {
        id: 'swapper.id-address',
        section: 'structure',
        severity: 'error',
        from: 'Swapper AS t',
        where: productIdMismatchSql(),
    },
    {
        id: 'classicVaultStrategy.id-address',
        section: 'structure',
        severity: 'error',
        from: 'ClassicVaultStrategy AS t',
        where: `${initialized} AND ${productIdMismatchSql()}`,
    },
    {
        id: 'clmStrategy.id-address',
        section: 'structure',
        severity: 'error',
        from: 'ClmStrategy AS t',
        where: `${initialized} AND ${productIdMismatchSql()}`,
    },
    blankField('ClassicPosition', 'classic_id', 'classicPosition.missing-classic'),
    blankField('ClassicPosition', 'account_id', 'classicPosition.missing-account'),
    blankField('ClmPosition', 'clm_id', 'clmPosition.missing-clm'),
    blankField('ClmPosition', 'account_id', 'clmPosition.missing-account'),
    blankField('ClassicSnapshot', 'classic_id', 'classicSnapshot.missing-classic'),
    blankField('ClmSnapshot', 'clm_id', 'clmSnapshot.missing-clm'),
    {
        id: 'classicSnapshot.unknown-period',
        section: 'structure',
        severity: 'error',
        from: 'ClassicSnapshot AS t',
        where: `t.period NOT IN (${SNAPSHOT_PERIODS.map((period) => `'${period}'`).join(', ')})`,
    },
    {
        id: 'clmSnapshot.unknown-period',
        section: 'structure',
        severity: 'error',
        from: 'ClmSnapshot AS t',
        where: `t.period NOT IN (${SNAPSHOT_PERIODS.map((period) => `'${period}'`).join(', ')})`,
    },
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
    zeroDecimals('LstVault', 'underlying_token_id', 'lstVault.underlying-token-decimals'),
    zeroDecimals('ClassicBoost', 'share_token_id', 'classicBoost.share-token-decimals'),
    zeroDecimals('ClassicBoost', 'underlying_token_id', 'classicBoost.underlying-token-decimals'),
    zeroDecimals('ClassicBoost', 'reward_token_id', 'classicBoost.reward-token-decimals'),
    zeroDecimals('RewardPool', 'share_token_id', 'rewardPool.share-token-decimals'),
    zeroDecimals('RewardPool', 'underlying_token_id', 'rewardPool.underlying-token-decimals'),
    zeroDecimals('ClassicErc4626Adapter', 'share_token_id', 'erc4626Adapter.share-token-decimals'),
    zeroDecimals('ClassicErc4626Adapter', 'underlying_token_id', 'erc4626Adapter.underlying-token-decimals'),
    {
        id: 'classic.underlying-balance-identity',
        section: 'sanity',
        severity: 'warning',
        from: 'Classic AS t',
        where: `${initialized} AND abs(${dec('t.underlying_amount')} - ${dec('t.vault_underlying_balance')}) > 0`,
    },
    {
        id: 'classic.negative-supply',
        section: 'sanity',
        severity: 'warning',
        from: 'Classic AS t',
        where: `${initialized} AND (${negativeCol('vault_token_total_supply')} OR ${negativeCol('underlying_amount')} OR ${negativeCol('vault_underlying_total_supply')} OR ${negativeCol('vault_underlying_balance')} OR ${negativeCol('total_call_fees')} OR ${negativeCol('total_beefy_fees')} OR ${negativeCol('total_strategist_fees')})`,
    },
    {
        id: 'clm.negative-amounts',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t',
        where: `${initialized} AND (${negativeCol('manager_total_supply')} OR ${negativeCol('total_underlying_amount0')} OR ${negativeCol('total_underlying_amount1')} OR ${negativeCol('underlying_idle_amount0')} OR ${negativeCol('underlying_idle_amount1')} OR ${negativeCol('underlying_locked_amount0')} OR ${negativeCol('underlying_locked_amount1')} OR ${negativeCol('underlying_unharvested_fees0')} OR ${negativeCol('underlying_unharvested_fees1')} OR ${negativeCol('underlying_main_amount0')} OR ${negativeCol('underlying_main_amount1')} OR ${negativeCol('underlying_alt_amount0')} OR ${negativeCol('underlying_alt_amount1')} OR ${negativeCol('total_call_fees')} OR ${negativeCol('total_beefy_fees')} OR ${negativeCol('total_strategist_fees')})`,
    },
    {
        id: 'clmSnapshot.amount0-identity',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmSnapshot AS t',
        where: clmAmountIdentitySql('0'),
    },
    {
        id: 'clmSnapshot.amount1-identity',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmSnapshot AS t',
        where: clmAmountIdentitySql('1'),
    },
    {
        id: 'classic.share-supply-mismatch',
        section: 'sanity',
        severity: 'warning',
        from: 'Classic AS t INNER JOIN Token AS token ON token.id = t.vault_token_id',
        where: `${initialized} AND abs(${dec('t.vault_token_total_supply')} - ${dec('token.total_supply')}) > 0`,
    },
    {
        id: 'clm.share-supply-mismatch',
        section: 'sanity',
        severity: 'warning',
        from: 'Clm AS t INNER JOIN Token AS token ON token.id = t.manager_token_id',
        where: `${initialized} AND ${clmShareSupplyMismatchSql()}`,
    },
    {
        id: 'swapper.missing-oracle',
        section: 'sanity',
        severity: 'warning',
        from: 'Swapper AS t',
        where: `t.oracle IS NULL OR ${zeroAddress('oracle')}`,
    },
    {
        id: 'swapper.missing-slippage',
        section: 'sanity',
        severity: 'warning',
        from: 'Swapper AS t',
        where: 't.slippage IS NULL',
    },
    {
        id: 'swapperRoute.same-token',
        section: 'sanity',
        severity: 'warning',
        from: 'SwapperRoute AS t',
        where: 't.from_token_id = t.to_token_id',
    },
    {
        id: 'swapperRoute.invalid-min-sign',
        section: 'sanity',
        severity: 'warning',
        from: 'SwapperRoute AS t',
        where: 't.min_amount_sign NOT IN (-1, 0, 1)',
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
        case 'ClassicSnapshot':
            return { entity: 'Classic', column: `${alias}.classic_id` };
        case 'ClmPosition':
        case 'ClmHarvestEvent':
        case 'ClmPositionInteraction':
        case 'ClmSnapshot':
        case 'ClmManagerCollectionEvent':
        case 'ClmDepositEvent':
        case 'ClmWithdrawEvent':
        case 'ClmStrategyTvlEvent':
            return { entity: 'Clm', column: `${alias}.clm_id` };
        case 'RewardPoolRewardedEvent':
            return { entity: 'RewardPool', column: `${alias}.pool_share_token_id` };
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

export const catalogPredicate = (from: string, idsByEntity: Map<IndexedEntity, readonly string[]>) => {
    const table = from.split(' ')[0];
    if (table === 'RewardPoolRewardedEvent') {
        const alias = firstAlias(from);
        const poolIds = [...(idsByEntity.get('RewardPool') ?? []), ...(idsByEntity.get('ClassicBoost') ?? [])];
        return sqlStringIn(`${alias}.pool_share_token_id`, poolIds);
    }
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
    {
        id: 'rewardPool.dual-parent',
        section: 'structure',
        severity: 'error',
        from: 'RewardPool AS t',
        where: `${initialized} AND NOT ${blank('classic_id')} AND NOT ${blank('clm_id')}`,
    },
    {
        id: 'rewardPool.share-token-identity',
        section: 'structure',
        severity: 'error',
        from: 'RewardPool AS t',
        where: `${initialized} AND t.share_token_id != t.id`,
    },
    {
        id: 'classicBoost.share-token-identity',
        section: 'structure',
        severity: 'error',
        from: 'ClassicBoost AS t',
        where: `${initialized} AND t.share_token_id != t.id`,
    },
    {
        id: 'lstVault.share-token-identity',
        section: 'structure',
        severity: 'error',
        from: 'LstVault AS t',
        where: `${initialized} AND t.share_token_id != t.id`,
    },
    {
        id: 'erc4626Adapter.share-token-identity',
        section: 'structure',
        severity: 'error',
        from: 'ClassicErc4626Adapter AS t',
        where: `${initialized} AND t.share_token_id != t.id`,
    },
    {
        id: 'erc4626Adapter.not-listed',
        section: 'structure',
        severity: 'error',
        from: 'ClassicErc4626Adapter AS t INNER JOIN Classic AS c ON c.id = t.classic_id',
        where: `${initialized} AND NOT has(c.erc4626_adapter_token_ids, t.share_token_id)`,
    },
    {
        id: 'classic.strategy-vault-mismatch',
        section: 'structure',
        severity: 'error',
        from: 'Classic AS t INNER JOIN ClassicVaultStrategy AS s ON s.id = t.classic_vault_strategy_id',
        where: `${initialized} AND s.classic_vault_id != t.id`,
    },
    {
        id: 'clm.strategy-manager-mismatch',
        section: 'structure',
        severity: 'error',
        from: 'Clm AS t INNER JOIN ClmStrategy AS s ON s.id = t.clm_strategy_id',
        where: `${initialized} AND s.clm_manager_id != t.id`,
    },
    {
        id: 'classic.pausable-mismatch',
        section: 'structure',
        severity: 'error',
        from: 'Classic AS t INNER JOIN ClassicVaultStrategy AS s ON s.id = t.classic_vault_strategy_id',
        where: `${initialized} AND t.pausable_status != s.pausable_status`,
    },
    {
        id: 'clm.pausable-mismatch',
        section: 'structure',
        severity: 'error',
        from: 'Clm AS t INNER JOIN ClmStrategy AS s ON s.id = t.clm_strategy_id',
        where: `${initialized} AND t.pausable_status != s.pausable_status`,
    },
    {
        id: 'classic.token-ids-order',
        section: 'structure',
        severity: 'error',
        from: 'Classic AS t',
        where: `${initialized} AND (${tokenIdsOrderMismatchSql('underlying_breakdown_token_ids', 'underlying_breakdown_tokens_order')} OR ${tokenIdsOrderMismatchSql('reward_pool_token_ids', 'reward_pool_tokens_order')} OR ${tokenIdsOrderMismatchSql('boost_reward_token_ids', 'boost_reward_tokens_order')} OR ${tokenIdsOrderMismatchSql('reward_token_ids', 'reward_tokens_order')} OR ${tokenIdsOrderMismatchSql('erc4626_adapter_token_ids', 'erc4626_adapter_tokens_order')})`,
    },
    {
        id: 'clm.token-ids-order',
        section: 'structure',
        severity: 'error',
        from: 'Clm AS t',
        where: `${initialized} AND (${tokenIdsOrderMismatchSql('reward_pool_token_ids', 'reward_pool_tokens_order')} OR ${tokenIdsOrderMismatchSql('output_token_ids', 'output_tokens_order')} OR ${tokenIdsOrderMismatchSql('reward_token_ids', 'reward_tokens_order')})`,
    },
    {
        id: 'classic.vault-token-id-address',
        section: 'structure',
        severity: 'error',
        from: 'Classic AS t INNER JOIN Token AS token ON token.id = t.vault_token_id',
        where: `${initialized} AND ${tokenIdMismatchSql('token')}`,
    },
    {
        id: 'clm.manager-token-id-address',
        section: 'structure',
        severity: 'error',
        from: 'Clm AS t INNER JOIN Token AS token ON token.id = t.manager_token_id',
        where: `${initialized} AND ${tokenIdMismatchSql('token')}`,
    },
];

const arraySum = (column: string) => `arraySum(arrayMap(x -> toDecimal256OrZero(x, 24), ${column}))`;

export const POSITION_PROBES: Probe[] = [
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
        where: `${dec('p.total_balance')} < 0 OR ${dec('p.vault_balance')} < 0 OR ${dec('p.boost_balance')} < 0 OR ${arrayHasNegative('reward_pool_balances', 'p')} OR ${arrayHasNegative('erc4626_adapter_balances', 'p')} OR ${arrayHasNegative('erc4626_adapter_vault_shares_balances', 'p')}`,
    },
    {
        id: 'classicPosition.vault-balance-mismatch',
        section: 'sanity',
        severity: 'warning',
        from: 'ClassicPosition AS p INNER JOIN Classic AS c ON c.id = p.classic_id LEFT JOIN TokenBalance AS tb ON tb.token_id = c.vault_token_id AND tb.account_id = p.account_id',
        where: `abs(${dec('p.vault_balance')} - ${dec("ifNull(tb.amount, '0')")}) > 0`,
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
        where: `${dec('p.total_balance')} < 0 OR ${dec('p.manager_balance')} < 0 OR ${arrayHasNegative('reward_pool_balances', 'p')}`,
    },
    {
        id: 'clmPosition.manager-balance-mismatch',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmPosition AS p INNER JOIN Clm AS c ON c.id = p.clm_id LEFT JOIN TokenBalance AS tb ON tb.token_id = c.manager_token_id AND tb.account_id = p.account_id',
        where: `abs(${dec('p.manager_balance')} - ${dec("ifNull(tb.amount, '0')")}) > 0`,
    },
    {
        id: 'clmPosition.reward-pool-balance-mismatch',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmPosition AS p INNER JOIN Clm AS c ON c.id = p.clm_id ARRAY JOIN arrayEnumerate(c.reward_pool_token_ids) AS idx LEFT JOIN TokenBalance AS tb ON tb.token_id = c.reward_pool_token_ids[idx] AND tb.account_id = p.account_id',
        where: `abs(${dec('p.reward_pool_balances[idx]')} - ${dec("ifNull(tb.amount, '0')")}) > 0`,
    },
    {
        id: 'classicPosition.reward-pool-balance-mismatch',
        section: 'sanity',
        severity: 'warning',
        from: 'ClassicPosition AS p INNER JOIN Classic AS c ON c.id = p.classic_id ARRAY JOIN arrayEnumerate(c.reward_pool_token_ids) AS idx LEFT JOIN TokenBalance AS tb ON tb.token_id = c.reward_pool_token_ids[idx] AND tb.account_id = p.account_id',
        where: `abs(${dec('p.reward_pool_balances[idx]')} - ${dec("ifNull(tb.amount, '0')")}) > 0`,
    },
    {
        id: 'classicPosition.adapter-balance-mismatch',
        section: 'sanity',
        severity: 'warning',
        from: 'ClassicPosition AS p INNER JOIN Classic AS c ON c.id = p.classic_id ARRAY JOIN arrayEnumerate(c.erc4626_adapter_token_ids) AS idx LEFT JOIN TokenBalance AS tb ON tb.token_id = c.erc4626_adapter_token_ids[idx] AND tb.account_id = p.account_id',
        where: `abs(${dec('p.erc4626_adapter_balances[idx]')} - ${dec("ifNull(tb.amount, '0')")}) > 0`,
    },
    {
        id: 'classicPosition.boost-balance-mismatch',
        section: 'sanity',
        severity: 'warning',
        from: `ClassicPosition AS p LEFT JOIN (
            SELECT b.classic_id AS classic_id, tb.account_id AS account_id, sum(${dec('tb.amount')}) AS boost_sum
            FROM ClassicBoost AS b
            INNER JOIN TokenBalance AS tb ON tb.token_id = b.share_token_id
            WHERE NOT ${blank('classic_id', 'b')} AND b.initializable_status = 'INITIALIZED'
            GROUP BY b.classic_id, tb.account_id
        ) AS x ON x.classic_id = p.classic_id AND x.account_id = p.account_id`,
        where: `abs(${dec('p.boost_balance')} - ifNull(x.boost_sum, 0)) > 0`,
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

const CLM_COLLECTION_PAIRS = [
    ['t.collected_output_amounts', 'c.output_tokens_order'],
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
    blankField('ClmManagerCollectionEvent', 'clm_id', 'clmCollection.missing-clm'),
    blankField('ClmManagerCollectionEvent', 'clm_strategy_id', 'clmCollection.missing-strategy'),
    blankField('ClmDepositEvent', 'clm_id', 'clmDeposit.missing-clm'),
    blankField('ClmDepositEvent', 'account_id', 'clmDeposit.missing-account'),
    blankField('ClmWithdrawEvent', 'clm_id', 'clmWithdraw.missing-clm'),
    blankField('ClmWithdrawEvent', 'account_id', 'clmWithdraw.missing-account'),
    blankField('ClmStrategyTvlEvent', 'clm_id', 'clmTvl.missing-clm'),
    blankField('ClmStrategyTvlEvent', 'clm_strategy_id', 'clmTvl.missing-strategy'),
    blankField('RewardPoolRewardedEvent', 'pool_share_token_id', 'rewarded.missing-pool-token'),
    blankField('RewardPoolRewardedEvent', 'reward_token_id', 'rewarded.missing-reward-token'),
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
    {
        id: 'clmCollection.array-alignment',
        section: 'structure',
        severity: 'error',
        from: 'ClmManagerCollectionEvent AS t INNER JOIN Clm AS c ON c.id = t.clm_id',
        where: pairMismatch(CLM_COLLECTION_PAIRS),
    },
    {
        id: 'classicInteraction.type-delta',
        section: 'sanity',
        severity: 'warning',
        from: 'ClassicPositionInteraction AS t',
        where: `(t.type = 'VAULT_DEPOSIT' AND ${dec('t.vault_balance_delta')} < 0) OR (t.type = 'VAULT_WITHDRAW' AND ${dec('t.vault_balance_delta')} > 0) OR (t.type = 'BOOST_STAKE' AND ${dec('t.boost_balance_delta')} < 0) OR (t.type = 'BOOST_UNSTAKE' AND ${dec('t.boost_balance_delta')} > 0) OR (t.type = 'CLASSIC_REWARD_POOL_STAKE' AND ${arraySum('t.reward_pool_balances_delta')} < 0) OR (t.type = 'CLASSIC_REWARD_POOL_UNSTAKE' AND ${arraySum('t.reward_pool_balances_delta')} > 0) OR (t.type = 'CLASSIC_ERC4626_ADAPTER_STAKE' AND ${arraySum('t.erc4626_adapter_balances_delta')} < 0) OR (t.type = 'CLASSIC_ERC4626_ADAPTER_UNSTAKE' AND ${arraySum('t.erc4626_adapter_balances_delta')} > 0)`,
    },
    {
        id: 'clmInteraction.type-delta',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmPositionInteraction AS t',
        where: `(t.type = 'MANAGER_DEPOSIT' AND ${dec('t.manager_balance_delta')} < 0) OR (t.type = 'MANAGER_WITHDRAW' AND ${dec('t.manager_balance_delta')} > 0) OR (t.type = 'CLM_REWARD_POOL_STAKE' AND ${arraySum('t.reward_pool_balances_delta')} < 0) OR (t.type = 'CLM_REWARD_POOL_UNSTAKE' AND ${arraySum('t.reward_pool_balances_delta')} > 0) OR (t.type = 'CLM_REWARD_POOL_CLAIM' AND ${blank('claimed_reward_pool_id')}) OR (t.type != 'CLM_REWARD_POOL_CLAIM' AND NOT ${blank('claimed_reward_pool_id')})`,
    },
    {
        id: 'clmDeposit.negative-amounts',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmDepositEvent AS t',
        where: `${negativeCol('shares')} OR ${negativeCol('amount0')} OR ${negativeCol('amount1')} OR ${negativeCol('fee0')} OR ${negativeCol('fee1')}`,
    },
    {
        id: 'clmWithdraw.negative-amounts',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmWithdrawEvent AS t',
        where: `${negativeCol('shares')} OR ${negativeCol('amount0')} OR ${negativeCol('amount1')}`,
    },
    {
        id: 'clmTvl.negative-amounts',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmStrategyTvlEvent AS t',
        where: `${negativeCol('underlying_amount0')} OR ${negativeCol('underlying_amount1')}`,
    },
    {
        id: 'classicHarvest.negative-compounded',
        section: 'sanity',
        severity: 'warning',
        from: 'ClassicHarvestEvent AS t',
        where: `${negativeCol('compounded_amount')} OR ${negativeCol('underlying_amount')} OR ${negativeCol('vault_token_total_supply')}`,
    },
    {
        id: 'clmHarvest.negative-compounded',
        section: 'sanity',
        severity: 'warning',
        from: 'ClmHarvestEvent AS t',
        where: `${negativeCol('compounded_amount0')} OR ${negativeCol('compounded_amount1')} OR ${negativeCol('underlying_amount0')} OR ${negativeCol('underlying_amount1')} OR ${negativeCol('manager_total_supply')}`,
    },
    {
        id: 'rewarded.negative-amount',
        section: 'sanity',
        severity: 'warning',
        from: 'RewardPoolRewardedEvent AS t',
        where: `${negativeCol('reward_amount')} OR toInt64OrZero(t.reward_vesting_seconds) < 0`,
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
            `SELECT toString(max(rounded_timestamp)) AS latest FROM ClockTick WHERE chain_id = ${chainId} AND period = '${CLOCK_TICK_PERIOD}'`
        );
        const latestAt = latest[0]?.latest;
        if (!latestAt || latestAt.startsWith('1970-')) {
            stale.push(String(chainId));
            continue;
        }
        const fresh = await client.query<{ count: string }>(
            `SELECT count() AS count FROM ClockTick WHERE chain_id = ${chainId} AND period = '${CLOCK_TICK_PERIOD}' AND rounded_timestamp >= now64(3) - INTERVAL 2 HOUR`
        );
        if (Number(fresh[0]?.count ?? 0) === 0) {
            stale.push(`${chainId} last=${latestAt}`);
        }
    }
    const unexpected = await Promise.all([
        client.query<{ count: string }>(
            `SELECT count() AS count FROM ClockTick WHERE ${chainIn('chain_id', chainIds)} AND period != '${CLOCK_TICK_PERIOD}'`
        ),
        client.query<{ id: string }>(
            `SELECT id FROM ClockTick WHERE ${chainIn('chain_id', chainIds)} AND period != '${CLOCK_TICK_PERIOD}' ORDER BY id LIMIT ${sampleSize}`
        ),
    ]);
    const findings: Finding[] = [];
    pushIfAny(
        findings,
        finding('sanity', 'warning', 'clockTick.stale-hourly', stale.length, stale.slice(0, sampleSize))
    );
    pushIfAny(
        findings,
        finding(
            'structure',
            'error',
            'clockTick.unexpected-period',
            Number(unexpected[0][0]?.count ?? 0),
            unexpected[1].map((row) => row.id)
        )
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

    const balanceFkWhere = `${chains} AND ${tokens} AND (${blank('account_id', 'tb')} OR ${blank('token_id', 'tb')})`;
    const balanceFks = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM TokenBalance AS tb WHERE ${balanceFkWhere}`),
        client.query<{ id: string }>(
            `SELECT tb.id AS id FROM TokenBalance AS tb WHERE ${balanceFkWhere} ORDER BY tb.id LIMIT ${sampleSize}`
        ),
    ]);
    pushIfAny(
        findings,
        finding(
            'structure',
            'error',
            'tokenBalance.missing-fk',
            Number(balanceFks[0][0]?.count ?? 0),
            balanceFks[1].map((row) => row.id)
        )
    );

    const tokenIdsSql = sqlStringIn('t.id', tokenIds);
    const tokenChains = chainIn('t.chain_id', chainIds);
    const holderWhere = `${tokenChains} AND ${tokenIdsSql} AND t.holder_count != toInt32(ifNull(h.holders, 0))`;
    const holderFrom = `Token AS t LEFT JOIN (SELECT token_id, countIf(${dec('tb.amount')} != 0) AS holders FROM TokenBalance AS tb WHERE ${chains} AND ${tokens} GROUP BY token_id) AS h ON h.token_id = t.id`;
    const holders = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM ${holderFrom} WHERE ${holderWhere}`),
        client.query<{ id: string }>(
            `SELECT t.id AS id FROM ${holderFrom} WHERE ${holderWhere} ORDER BY t.id LIMIT ${sampleSize}`
        ),
    ]);
    pushIfAny(
        findings,
        finding(
            'sanity',
            'warning',
            'token.holder-count-mismatch',
            Number(holders[0][0]?.count ?? 0),
            holders[1].map((row) => row.id)
        )
    );

    const circulating = `tb.account_id NOT IN ('0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead')`;
    const supplyWhere = `${tokenChains} AND ${tokenIdsSql} AND abs(${dec('t.total_supply')} - ifNull(s.balance_sum, 0)) > 0`;
    const supplyFrom = `Token AS t LEFT JOIN (SELECT token_id, sum(${dec('tb.amount')}) AS balance_sum FROM TokenBalance AS tb WHERE ${chains} AND ${tokens} AND ${circulating} GROUP BY token_id) AS s ON s.token_id = t.id`;
    const supplies = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM ${supplyFrom} WHERE ${supplyWhere}`),
        client.query<{ id: string }>(
            `SELECT t.id AS id FROM ${supplyFrom} WHERE ${supplyWhere} ORDER BY t.id LIMIT ${sampleSize}`
        ),
    ]);
    pushIfAny(
        findings,
        finding(
            'sanity',
            'warning',
            'token.supply-sum-mismatch',
            Number(supplies[0][0]?.count ?? 0),
            supplies[1].map((row) => row.id)
        )
    );

    const tokenNegWhere = `${tokenChains} AND ${tokenIdsSql} AND (t.holder_count < 0 OR ${dec('t.total_supply')} < 0)`;
    const tokenNeg = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM Token AS t WHERE ${tokenNegWhere}`),
        client.query<{ id: string }>(
            `SELECT t.id AS id FROM Token AS t WHERE ${tokenNegWhere} ORDER BY t.id LIMIT ${sampleSize}`
        ),
    ]);
    pushIfAny(
        findings,
        finding(
            'sanity',
            'warning',
            'token.negative-metrics',
            Number(tokenNeg[0][0]?.count ?? 0),
            tokenNeg[1].map((row) => row.id)
        )
    );

    const tokenIdWhere = `${tokenChains} AND ${tokenIdsSql} AND ${tokenIdMismatchSql('t')}`;
    const tokenIdsBad = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM Token AS t WHERE ${tokenIdWhere}`),
        client.query<{ id: string }>(
            `SELECT t.id AS id FROM Token AS t WHERE ${tokenIdWhere} ORDER BY t.id LIMIT ${sampleSize}`
        ),
    ]);
    pushIfAny(
        findings,
        finding(
            'structure',
            'error',
            'token.id-address',
            Number(tokenIdsBad[0][0]?.count ?? 0),
            tokenIdsBad[1].map((row) => row.id)
        )
    );

    const accountWhere = `${chainIn('t.chain_id', chainIds)} AND ${accountIdMismatchSql('t')}`;
    const accounts = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM Account AS t WHERE ${accountWhere}`),
        client.query<{ id: string }>(
            `SELECT t.id AS id FROM Account AS t WHERE ${accountWhere} ORDER BY t.id LIMIT ${sampleSize}`
        ),
    ]);
    pushIfAny(
        findings,
        finding(
            'structure',
            'error',
            'account.id-address',
            Number(accounts[0][0]?.count ?? 0),
            accounts[1].map((row) => row.id)
        )
    );

    const continuityFrom = `(
        SELECT
            t.id AS id,
            ${dec('t.balance_before')} AS before,
            lagInFrame(${dec('t.balance_after')}) OVER (PARTITION BY t.token_balance_id ORDER BY ${changeBlockSeq('t')}) AS prev_after,
            row_number() OVER (PARTITION BY t.token_balance_id ORDER BY ${changeBlockSeq('t')}) AS rn
        FROM TokenBalanceChange AS t
        WHERE ${chainIn('t.chain_id', chainIds)} AND ${changeTokens}
    ) AS x`;
    const continuityWhere = 'rn > 1 AND before != prev_after';
    const continuity = await Promise.all([
        client.query<{ count: string }>(`SELECT count() AS count FROM ${continuityFrom} WHERE ${continuityWhere}`),
        client.query<{ id: string }>(
            `SELECT x.id AS id FROM ${continuityFrom} WHERE ${continuityWhere} ORDER BY x.id LIMIT ${sampleSize}`
        ),
    ]);
    pushIfAny(
        findings,
        finding(
            'sanity',
            'warning',
            'tokenBalanceChange.continuity',
            Number(continuity[0][0]?.count ?? 0),
            continuity[1].map((row) => row.id)
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
