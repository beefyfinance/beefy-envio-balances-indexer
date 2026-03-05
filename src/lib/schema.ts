/**
 * Single entry point for all generated types and handler hooks.
 * Only this file may import from "generated" or "generated/...".
 *
 * Naming:
 * - Types use _t suffix for entity types only (e.g. Account_t, Token_t).
 * - Handler hooks use _h suffix (e.g. ClassicBoost_h.Initialized.handler).
 */

// ——— Handler hooks (_h convention) ———
// ——— Runtime ———
export {
    ClassicBoost as ClassicBoost_h,
    ClassicBoostFactory as ClassicBoostFactory_h,
    ClassicStrategy as ClassicStrategy_h,
    ClassicStrategyFactory as ClassicStrategyFactory_h,
    ClassicVault as ClassicVault_h,
    ClassicVaultFactory as ClassicVaultFactory_h,
    ClmManager as ClmManager_h,
    ClmManagerFactory as ClmManagerFactory_h,
    ClmStrategy as ClmStrategy_h,
    ClmStrategyFactory as ClmStrategyFactory_h,
    ContractFactory as ContractFactory_h,
    Erc4626Adapter as Erc4626Adapter_h,
    Erc4626AdapterFactory as Erc4626AdapterFactory_h,
    indexer,
    LstVault as LstVault_h,
    RewardPool as RewardPool_h,
    RewardPoolFactory as RewardPoolFactory_h,
    Token as Token_h,
} from 'generated';
// ——— Types ———
export type {
    Block_t as Block,
    Entities_Account_t as Account_t,
    Entities_ClassicBoost_t as ClassicBoost_t,
    Entities_ClassicVault_t as ClassicVault_t,
    Entities_ClassicVaultStrategy_t as ClassicVaultStrategy_t,
    Entities_ClmManager_t as ClmManager_t,
    Entities_ClmStrategy_t as ClmStrategy_t,
    Entities_Erc4626Adapter_t as Erc4626Adapter_t,
    Entities_LstVault_t as LstVault_t,
    Entities_PoolRewardedEvent_t as PoolRewardedEvent_t,
    Entities_RewardPool_t as RewardPool_t,
    Entities_Token_t as Token_t,
    Entities_TokenBalance_t as TokenBalance_t,
    Entities_TokenBalanceChange_t as TokenBalanceChange_t,
    handlerContext as HandlerContext,
} from 'generated/src/Indexer.gen';
