/**
 * One-time on-chain facts per contract (docs/architecture.md, "Allowed eth_calls").
 *
 * Every effect is chain-scoped and cached, keyed on the contract address only, and reads at `latest`: these values
 * are immutable once the contract is initialized (reading at an early block is wrong anyway: `want()` / `wants()`
 * return 0x0 until the strategy is initialized). Concurrent reads at `latest` share one aggregate3 (src/lib/viem.ts).
 *
 * A complete answer is cached. An incomplete one (a revert or a zero address where a value is expected) is returned
 * with `context.cache = false`, so a later retry (registry.ts, at most once per FACTS_RETRY_BLOCKS) reads again.
 * Transport errors throw and are never cached.
 */

import { createEffect, type EffectContext, type EvmChainId, S } from 'envio';
import type { Abi } from 'viem';

import { staticStrategyVaultMap, staticVaultsMap } from '../config/classic/staticVaults';
import { classifyClassicProxyReads } from '../lib/classify';
import { asHex, type Hex, nonZeroAddress } from '../lib/hex';
import { getViemClient } from '../lib/viem';
import { classicBoostAbi } from './abis/beefy/classic/ClassicBoost';
import { classicStrategyAbi } from './abis/beefy/classic/ClassicStrategy';
import { classicVaultAbi } from './abis/beefy/classic/ClassicVault';
import { classicVaultFactoryDetectionAbi } from './abis/beefy/classic/ClassicVaultFactory';
import { clmManagerAbi } from './abis/beefy/clm/ClmManager';
import { clmStrategyAbi } from './abis/beefy/clm/ClmStrategy';
import { erc4626AdapterAbi } from './abis/beefy/common/Erc4626Adapter';
import { rewardPoolAbi } from './abis/beefy/common/RewardPool';
import { lstVaultAbi } from './abis/beefy/lst/LstVault';

// a fresh object per effect: createEffect turns the literal into a schema in place
const factInput = () => ({ address: S.string });
const optionalAddress = S.optional(S.string);

type CallResult = { status: 'success' | 'failure'; result?: unknown };

/** No-argument view calls on one contract in one multicall group, at `block` or at `latest`. */
export const readCalls = async (
    context: EffectContext,
    address: string,
    block: number | undefined,
    abi: Abi,
    functionNames: readonly string[]
): Promise<CallResult[]> => {
    const client = getViemClient(context.chain.id as EvmChainId, context.log);
    const results = await client.multicall({
        allowFailure: true,
        ...(block === undefined ? {} : { blockNumber: BigInt(block) }),
        contracts: functionNames.map((functionName) => ({
            address: asHex(address),
            abi,
            functionName,
            args: [],
        })),
    });
    return results;
};

const addressResult = (result: CallResult | undefined): Hex | undefined =>
    result?.status === 'success' && typeof result.result === 'string' ? nonZeroAddress(result.result) : undefined;

/** Caches the answer only when every expected value is there. */
const complete = <T extends Record<string, unknown>>(context: EffectContext, facts: T, expected: (keyof T)[]): T => {
    context.cache = expected.every((key) => facts[key] !== undefined);
    return facts;
};

/** Classic vault: `want()` (older vaults: `token()`). The strategy history comes from strategy facts and events. */
export const readVaultFacts = createEffect(
    {
        name: 'readVaultFacts',
        input: factInput(),
        output: S.schema({ want: optionalAddress }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const staticVault = staticVaultsMap[context.chain.id]?.[asHex(input.address)];
        if (staticVault) return { want: staticVault.want };
        const [want, token] = await readCalls(context, input.address, undefined, classicVaultAbi, ['want', 'token']);
        return complete(context, { want: addressResult(want) ?? addressResult(token) }, ['want']);
    }
);

/** Classic or CLM strategy: `vault()` (the classic vault, or the CLM manager). CLM strategies also `pool()`. */
export const readStrategyFacts = createEffect(
    {
        name: 'readStrategyFacts',
        input: { ...factInput(), clm: S.boolean },
        output: S.schema({ vault: optionalAddress, pool: optionalAddress }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        if (!input.clm) {
            const staticVault = staticStrategyVaultMap[context.chain.id]?.[asHex(input.address)];
            if (staticVault) return { vault: staticVault, pool: undefined };
            const [vault] = await readCalls(context, input.address, undefined, classicStrategyAbi, ['vault']);
            return complete(context, { vault: addressResult(vault), pool: undefined }, ['vault']);
        }
        const [vault, pool] = await readCalls(context, input.address, undefined, clmStrategyAbi, ['vault', 'pool']);
        return complete(context, { vault: addressResult(vault), pool: addressResult(pool) }, ['vault', 'pool']);
    }
);

/** Classic boost (launchpool): `stakedToken()` / `rewardToken()`. */
export const readBoostFacts = createEffect(
    {
        name: 'readBoostFacts',
        input: factInput(),
        output: S.schema({ stakedToken: optionalAddress, rewardToken: optionalAddress }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const [stakedToken, rewardToken] = await readCalls(context, input.address, undefined, classicBoostAbi, [
            'stakedToken',
            'rewardToken',
        ]);
        return complete(context, { stakedToken: addressResult(stakedToken), rewardToken: addressResult(rewardToken) }, [
            'stakedToken',
            'rewardToken',
        ]);
    }
);

/** Reward pool: `stakedToken()` (reward tokens come from `AddReward` events). */
export const readRewardPoolFacts = createEffect(
    {
        name: 'readRewardPoolFacts',
        input: factInput(),
        output: S.schema({ stakedToken: optionalAddress }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const [stakedToken] = await readCalls(context, input.address, undefined, rewardPoolAbi, ['stakedToken']);
        return complete(context, { stakedToken: addressResult(stakedToken) }, ['stakedToken']);
    }
);

/** CLM manager: `wants()`. */
export const readClmManagerFacts = createEffect(
    {
        name: 'readClmManagerFacts',
        input: factInput(),
        output: S.schema({ want0: optionalAddress, want1: optionalAddress }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const [wants] = await readCalls(context, input.address, undefined, clmManagerAbi, ['wants']);
        const [want0, want1] =
            wants?.status === 'success' && Array.isArray(wants.result) ? (wants.result as [string, string]) : [];
        return complete(context, { want0: nonZeroAddress(want0), want1: nonZeroAddress(want1) }, ['want0', 'want1']);
    }
);

/** LST vault: `asset()` (older LSTs: `want()`). */
export const readAssetFacts = createEffect(
    {
        name: 'readAssetFacts',
        input: factInput(),
        output: S.schema({ asset: optionalAddress }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const [asset, want] = await readCalls(context, input.address, undefined, lstVaultAbi, ['asset', 'want']);
        return complete(context, { asset: addressResult(asset) ?? addressResult(want) }, ['asset']);
    }
);

/** ERC-4626 adapter (BeefyWrapper): `vault()`, the wrapped Beefy vault. */
export const readAdapterFacts = createEffect(
    {
        name: 'readAdapterFacts',
        input: factInput(),
        output: S.schema({ vault: optionalAddress }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const [vault] = await readCalls(context, input.address, undefined, erc4626AdapterAbi, ['vault']);
        return complete(context, { vault: addressResult(vault) }, ['vault']);
    }
);

const classicProxyKind = S.union(['VAULT', 'STRATEGY', 'BOOST', 'UNKNOWN']);

/**
 * ClassicVaultFactory deploys vaults, strategies and boosts with the same `ProxyCreated` event. Used whenever the
 * transaction input does not pin the kind (`cloneContract` clones anything; multisig / deployer calls do not
 * decode). A vault answers `strategy()`, a strategy `vault()`, a boost `rewardToken()`; exactly one must succeed.
 * UNKNOWN is not cached.
 */
export const classifyClassicProxy = createEffect(
    {
        name: 'classifyClassicProxy',
        input: factInput(),
        output: S.schema({ kind: classicProxyKind }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const [vault, strategy, rewardToken] = await readCalls(
            context,
            input.address,
            undefined,
            // outputs are ignored: only whether each call succeeds matters
            classicVaultFactoryDetectionAbi as unknown as Abi,
            ['vault', 'strategy', 'rewardToken']
        );
        const kind = classifyClassicProxyReads({
            vault: vault?.status === 'success',
            strategy: strategy?.status === 'success',
            rewardToken: rewardToken?.status === 'success',
        });
        if (kind === 'UNKNOWN') {
            context.log.error('ClassicVaultFactory proxy classification failed', {
                address: input.address,
                vault: vault?.status,
                strategy: strategy?.status,
                rewardToken: rewardToken?.status,
            });
            context.cache = false;
        }
        return { kind };
    }
);
