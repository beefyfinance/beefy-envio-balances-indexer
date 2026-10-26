/**
 * Running sums: `Balance` (account x token), `TokenSupply` (token), and the `BalanceChange` step function.
 *
 * - Mint = transfer from 0x0, burn = transfer to 0x0 (what `totalSupply()` tracks).
 * - Every account except 0x0 gets Balance / BalanceChange rows (0xdead, zaps, swappers included: filtering holders
 *   is the wrapper's job). 0x0 is the mint / burn side, tracked by TokenSupply instead.
 * - Zero-value transfers and self-transfers change no balance: only the ShareTransfer row is written.
 */

import type { Balance, BalanceChange, EvmOnEventContext } from 'envio';

import { eventColumns, eventId, type RawEvent } from './event';
import { asHex, isZeroAddress } from './hex';

type Context = EvmOnEventContext;

const balanceId = (chainId: number, token: string, account: string) => `${chainId}-${asHex(token)}-${asHex(account)}`;
const supplyId = (chainId: number, token: string) => `${chainId}-${asHex(token)}`;

type Delta = { account: string; delta: bigint };

/** Applies balance deltas of one event (reads first, then writes, so preload loads every row it needs). */
const applyBalanceDeltas = async (
    context: Context,
    event: RawEvent,
    token: string,
    source: BalanceChange['source'],
    deltas: Delta[]
) => {
    const tracked = deltas.filter(({ account, delta }) => delta !== 0n && !isZeroAddress(account));
    const current = await Promise.all(
        tracked.map(({ account }) => context.Balance.get(balanceId(event.chainId, token, account)))
    );
    const columns = eventColumns(event);
    tracked.forEach(({ account, delta }, index) => {
        const balanceAfter = (current[index]?.balance ?? 0n) + delta;
        const balance: Balance = {
            id: balanceId(event.chainId, token, account),
            token: asHex(token),
            account: asHex(account),
            balance: balanceAfter,
            lastChangeBlock: columns.blockNumber,
        };
        context.Balance.set(balance);
        context.BalanceChange.set({
            ...columns,
            id: `${eventId(event)}-${asHex(account)}`,
            token: asHex(token),
            account: asHex(account),
            delta,
            balanceAfter,
            source,
        });
    });
};

/** Adds `delta` to the token's running supply and returns the supply after it. */
const applySupplyDelta = async (context: Context, event: RawEvent, token: string, delta: bigint) => {
    const id = supplyId(event.chainId, token);
    const current = await context.TokenSupply.get(id);
    const totalSupply = (current?.totalSupply ?? 0n) + delta;
    context.TokenSupply.set({
        id,
        token: asHex(token),
        totalSupply,
        lastChangeBlock: BigInt(event.block.number),
    });
    return totalSupply;
};

/** ERC-20 `Transfer` of a Beefy share token (the emitter): ShareTransfer + both balance sides + supply on mint/burn. */
export const handleShareTransfer = async (
    context: Context,
    event: RawEvent & { params: { from: string; to: string; value: bigint } }
) => {
    const token = asHex(event.srcAddress);
    const from = asHex(event.params.from);
    const to = asHex(event.params.to);
    const { value } = event.params;
    const isMint = isZeroAddress(from);
    const isBurn = isZeroAddress(to);

    const [totalSupplyAfter] = await Promise.all([
        isMint !== isBurn ? applySupplyDelta(context, event, token, isMint ? value : -value) : undefined,
        from === to
            ? undefined
            : applyBalanceDeltas(context, event, token, 'TRANSFER', [
                  { account: from, delta: -value },
                  { account: to, delta: value },
              ]),
    ]);

    context.ShareTransfer.set({
        ...eventColumns(event),
        token,
        fromAddress: from,
        toAddress: to,
        value,
        totalSupplyAfter,
    });
};

/** Boost `Staked` / `Withdrawn`: the boost is treated as a share token (balances API semantics). */
export const handleBoostStake = async (
    context: Context,
    event: RawEvent & { params: { user: string; amount: bigint } },
    direction: 'STAKE' | 'UNSTAKE'
) => {
    const boost = asHex(event.srcAddress);
    const user = asHex(event.params.user);
    const delta = direction === 'STAKE' ? event.params.amount : -event.params.amount;
    await Promise.all([
        applySupplyDelta(context, event, boost, delta),
        applyBalanceDeltas(context, event, boost, 'BOOST_STAKE', [{ account: user, delta }]),
    ]);
    context.BoostStake.set({
        ...eventColumns(event),
        boost,
        user,
        amount: event.params.amount,
        direction,
    });
};
