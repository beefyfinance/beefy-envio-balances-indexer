import { createEffect, S } from 'envio';
import { clmStrategyAbi } from './abis/beefy/clm/ClmStrategy';
import { readCalls } from './facts.effects';

const optionalAmount = S.optional(S.bigint);

/**
 * Raw CLM strategy state at a block with a `TVL` or `Harvest` event: `price()`, `range()`, `balancesOfPool()` in one
 * multicall. Keyed on (strategy, block) so a harvest and the TVL event it emits share one read. This is the only
 * eth_call that scales with events (docs/architecture.md, "Allowed eth_calls").
 */
export const readClmPoolState = createEffect(
    {
        name: 'readClmPoolState',
        input: { strategy: S.string, block: S.number },
        output: S.schema({
            status: S.union(['ok', 'failed']),
            price: optionalAmount,
            rangeLower: optionalAmount,
            rangeUpper: optionalAmount,
            token0Bal: optionalAmount,
            token1Bal: optionalAmount,
            mainAmount0: optionalAmount,
            mainAmount1: optionalAmount,
            altAmount0: optionalAmount,
            altAmount1: optionalAmount,
        }),
        rateLimit: false,
        cache: true,
        crossChain: false,
    },
    async ({ input, context }) => {
        const [price, range, balances] = await readCalls(context, input.strategy, input.block, clmStrategyAbi, [
            'price',
            'range',
            'balancesOfPool',
        ]);
        const rangeValues = range?.status === 'success' ? (range.result as readonly [bigint, bigint]) : undefined;
        const balanceValues =
            balances?.status === 'success'
                ? (balances.result as readonly [bigint, bigint, bigint, bigint, bigint, bigint])
                : undefined;
        const ok = price?.status === 'success' && rangeValues !== undefined && balanceValues !== undefined;
        if (!ok) {
            context.log.warn('CLM pool state read reverted', {
                strategy: input.strategy,
                block: input.block,
                price: price?.status,
                range: range?.status,
                balancesOfPool: balances?.status,
            });
        }
        return {
            status: ok ? ('ok' as const) : ('failed' as const),
            price: price?.status === 'success' ? (price.result as bigint) : undefined,
            rangeLower: rangeValues?.[0],
            rangeUpper: rangeValues?.[1],
            token0Bal: balanceValues?.[0],
            token1Bal: balanceValues?.[1],
            mainAmount0: balanceValues?.[2],
            mainAmount1: balanceValues?.[3],
            altAmount0: balanceValues?.[4],
            altAmount1: balanceValues?.[5],
        };
    }
);
