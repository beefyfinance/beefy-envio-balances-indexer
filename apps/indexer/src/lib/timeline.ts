/**
 * `TimelineEvent`: everything an account did, one row per account and kind (docs/timeline-redesign.md).
 *
 * - BALANCE: each side of a balance change (src/lib/balances.ts).
 * - MINT / BURN: a share token transfer from 0x0 marks the receiver, one to 0x0 the sender.
 * - Zap attribution: in one transaction and token, an account that received shares from 0x0 and forwards the same
 *   value to another account at a later log marks the receiver MINT at the forwarding log. An account that receives a
 *   value and burns the same value at a later log marks each sender of that value BURN at its transfer log. There is
 *   no router list: a transfer between two people has no mint or burn of the same value around it, and a fee taken
 *   on the way breaks the match (it stays a plain transfer).
 * - CLM_DEPOSIT / CLM_WITHDRAW: CLM manager Deposit / Withdraw, for the user.
 * - CLAIM: reward pool and boost RewardPaid, for the user.
 * - Price facts (`headProduct`, `headDecimals`, `headProductKind`, `headContractKind`): the emitting contract's,
 *   once known. Indexer price (`headPrice`, `headPriceAt`): the cached Beefy API price of that product
 *   (src/lib/headPrices.ts), on events recent enough when the handler runs; else unset.
 *
 * Ids are `chainId-trxHash-logIndex-account-kind`, stable across reindexes.
 */

import type { Contract, EvmOnEventContext, ShareFlow, TimelineEvent } from 'envio';
import { zeroAddress } from 'viem';

import { blockTimestamp, type RawEvent } from './event';
import { headPriceAt } from './headPrices';
import { asHex, isZeroAddress } from './hex';

type Context = EvmOnEventContext;
type Kind = TimelineEvent['kind'];

/** The kind-specific columns; every other one is '' or 0. */
type Fields = Partial<
    Pick<TimelineEvent, 'source' | 'delta' | 'sharesAfter' | 'amount0' | 'amount1' | 'rewardToken' | 'rewardAmount'>
>;

type HeadColumns = Pick<
    TimelineEvent,
    'headPrice' | 'headPriceAt' | 'headProduct' | 'headDecimals' | 'headProductKind' | 'headContractKind'
>;

const NO_HEAD: HeadColumns = {
    headPrice: undefined,
    headPriceAt: undefined,
    headProduct: undefined,
    headDecimals: undefined,
    headProductKind: undefined,
    headContractKind: undefined,
};

/**
 * The price facts of a row of `contract` (the emitter) when they are known, and its indexer price when the age rules
 * pass too.
 */
const headColumns = (event: RawEvent, contract: Contract): HeadColumns => {
    const { productAddress, priceDecimals, productKind } = contract;
    if (productAddress === undefined || priceDecimals === undefined || productKind === undefined) return NO_HEAD;
    const head = headPriceAt(event.chainId, productAddress, event.block.timestamp);
    return {
        headPrice: head?.price,
        headPriceAt: head === undefined ? undefined : new Date(head.fetchedAt),
        headProduct: productAddress,
        headDecimals: priceDecimals,
        headProductKind: productKind,
        headContractKind: contract.kind,
    };
};

/** A timeline row of `event`'s transaction, at `logIndex` (the event's own by default), for the emitting contract. */
const timelineRow = (
    event: RawEvent,
    contract: Contract,
    account: string,
    kind: Kind,
    fields: Fields,
    logIndex = event.logIndex
): TimelineEvent => ({
    id: `${event.chainId}-${asHex(event.transaction.hash)}-${logIndex}-${asHex(account)}-${kind}`,
    account: asHex(account),
    kind,
    contract: contract.address,
    source: '',
    delta: 0n,
    sharesAfter: 0n,
    amount0: 0n,
    amount1: 0n,
    rewardToken: '',
    rewardAmount: 0n,
    ...fields,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: blockTimestamp(event),
    logIndex,
    trxHash: asHex(event.transaction.hash),
    ...headColumns(event, contract),
});

/** A row of the event's emitter `contract` (its registry row, from ensureContract). */
export const writeTimelineEvent = (
    context: Context,
    event: RawEvent,
    contract: Contract,
    account: string,
    kind: Kind,
    fields: Fields = {}
) => context.TimelineEvent.set(timelineRow(event, contract, account, kind, fields));

const flowId = (chainId: number, token: string) => `${chainId}-${asHex(token)}`;

/**
 * MINT / BURN rows of a share token `Transfer`, direct and routed. Costs one `ShareFlow.get` per transfer (keyed on
 * the token only, so preload loads it) and one `ShareFlow.set` per mint and per transfer between two accounts.
 */
export const writeTransferTimeline = async (
    context: Context,
    event: RawEvent,
    token: Contract,
    from: string,
    to: string,
    value: bigint
) => {
    const isMint = isZeroAddress(from);
    const isBurn = isZeroAddress(to);
    const id = flowId(event.chainId, token.address);
    const stored = await context.ShareFlow.get(id);
    const trxHash = asHex(event.transaction.hash);
    // handlers run in log order per chain, so a flow of another transaction is over
    const flow: ShareFlow =
        stored?.trxHash === trxHash
            ? stored
            : { id, trxHash, fromAddresses: [], toAddresses: [], values: [], logIndexes: [] };
    const legs = flow.values.map((legValue, index) => ({
        from: flow.fromAddresses[index] ?? zeroAddress,
        to: flow.toAddresses[index] ?? zeroAddress,
        value: legValue,
        logIndex: flow.logIndexes[index] ?? 0,
    }));

    if (isMint) writeTimelineEvent(context, event, token, to, 'MINT');
    if (isBurn) writeTimelineEvent(context, event, token, from, 'BURN');
    if (isMint && isBurn) return;

    if (isBurn) {
        // `from` gives up shares it received in this transaction: each sender of the same value withdrew through it
        legs.filter((leg) => !isZeroAddress(leg.from) && leg.to === asHex(from) && leg.value === value).forEach((leg) =>
            context.TimelineEvent.set(timelineRow(event, token, leg.from, 'BURN', {}, leg.logIndex))
        );
        return;
    }
    // `from` forwards shares minted to it in this transaction: the receiver deposited through it
    if (!isMint && legs.some((leg) => isZeroAddress(leg.from) && leg.to === asHex(from) && leg.value === value)) {
        writeTimelineEvent(context, event, token, to, 'MINT');
    }
    context.ShareFlow.set({
        ...flow,
        fromAddresses: [...flow.fromAddresses, asHex(from)],
        toAddresses: [...flow.toAddresses, asHex(to)],
        values: [...flow.values, value],
        logIndexes: [...flow.logIndexes, event.logIndex],
    });
};
