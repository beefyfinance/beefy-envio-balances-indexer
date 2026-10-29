/**
 * Running sums: `Balance` (account x token), `TokenSupply` (token), and the balance step function as BALANCE
 * `TimelineEvent` rows (with the MINT / BURN rows of each transfer: src/lib/timeline.ts).
 *
 * - Mint = transfer from 0x0, burn = transfer to 0x0 (what `totalSupply()` tracks).
 * - Every account except 0x0 gets Balance / BALANCE rows (0xdead, zaps, swappers included: filtering holders
 *   is the wrapper's job). 0x0 is the mint / burn side, tracked by TokenSupply instead.
 * - Zero-value transfers and self-transfers change no balance: only the ShareTransfer row is written.
 */

import type { Balance, Contract, EvmOnEventContext } from 'envio';

import { eventColumns, type RawEvent } from './event';
import { asHex, isZeroAddress } from './hex';
import { writeTimelineEvent, writeTransferTimeline } from './timeline';

type Context = EvmOnEventContext;

const balanceId = (chainId: number, token: string, account: string) => `${chainId}-${asHex(token)}-${asHex(account)}`;
const supplyId = (chainId: number, token: string) => `${chainId}-${asHex(token)}`;

type Delta = { account: string; delta: bigint };
/** `TimelineEvent.source` of a BALANCE row. */
type BalanceSource = 'TRANSFER' | 'BOOST_STAKE';

/** Applies balance deltas of one event (reads first, then writes, so preload loads every row it needs). */
const applyBalanceDeltas = async (
    context: Context,
    event: RawEvent,
    contract: Contract,
    source: BalanceSource,
    deltas: Delta[]
) => {
    const token = contract.address;
    const tracked = deltas.filter(({ account, delta }) => delta !== 0n && !isZeroAddress(account));
    const current = await Promise.all(
        tracked.map(({ account }) => context.Balance.get(balanceId(event.chainId, token, account)))
    );
    tracked.forEach(({ account, delta }, index) => {
        const balanceAfter = (current[index]?.balance ?? 0n) + delta;
        const balance: Balance = {
            id: balanceId(event.chainId, token, account),
            token: asHex(token),
            account: asHex(account),
            balance: balanceAfter,
            lastChangeBlock: BigInt(event.block.number),
        };
        context.Balance.set(balance);
        writeTimelineEvent(context, event, contract, account, 'BALANCE', { source, delta, sharesAfter: balanceAfter });
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

/**
 * ERC-20 `Transfer` of a Beefy share token (the emitter, `contract` its registry row): ShareTransfer + both balance
 * sides + supply on mint/burn.
 */
export const handleShareTransfer = async (
    context: Context,
    event: RawEvent & { params: { from: string; to: string; value: bigint } },
    contract: Contract
) => {
    const token = contract.address;
    const from = asHex(event.params.from);
    const to = asHex(event.params.to);
    const { value } = event.params;
    const isMint = isZeroAddress(from);
    const isBurn = isZeroAddress(to);

    const [totalSupplyAfter] = await Promise.all([
        isMint !== isBurn ? applySupplyDelta(context, event, token, isMint ? value : -value) : undefined,
        from === to
            ? undefined
            : applyBalanceDeltas(context, event, contract, 'TRANSFER', [
                  { account: from, delta: -value },
                  { account: to, delta: value },
              ]),
        writeTransferTimeline(context, event, contract, from, to, value),
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
    contract: Contract,
    direction: 'STAKE' | 'UNSTAKE'
) => {
    const boost = contract.address;
    const user = asHex(event.params.user);
    const delta = direction === 'STAKE' ? event.params.amount : -event.params.amount;
    await Promise.all([
        applySupplyDelta(context, event, boost, delta),
        applyBalanceDeltas(context, event, contract, 'BOOST_STAKE', [{ account: user, delta }]),
    ]);
    context.BoostStake.set({
        ...eventColumns(event),
        boost,
        user,
        amount: event.params.amount,
        direction,
    });
};
