import { type EvmOnEventContext, type Harvest, indexer } from 'envio';
import { readClmPoolState } from '../effects/clmPoolState.effects';
import { blockTimestamp, eventColumns, type RawEvent } from '../lib/event';
import { asHex } from '../lib/hex';
import { ensureContract } from '../lib/registry';
import { writePauseChange } from '../lib/rows';

/** One cached multicall per (strategy, block): a Harvest and the TVL event of the same block share it. */
const writeClmPoolState = async (context: EvmOnEventContext, event: RawEvent) => {
    const strategy = asHex(event.srcAddress);
    const state = await context.effect(readClmPoolState, { strategy, block: event.block.number });
    context.ClmPoolState.set({
        id: `${event.chainId}-${strategy}-${event.block.number}`,
        strategy,
        status: state.status === 'ok' ? 'OK' : 'FAILED',
        price: state.price,
        rangeLower: state.rangeLower,
        rangeUpper: state.rangeUpper,
        token0Bal: state.token0Bal,
        token1Bal: state.token1Bal,
        mainAmount0: state.mainAmount0,
        mainAmount1: state.mainAmount1,
        altAmount0: state.altAmount0,
        altAmount1: state.altAmount1,
        blockNumber: BigInt(event.block.number),
        blockTimestamp: blockTimestamp(event),
    });
};

const harvestRow = (
    event: RawEvent,
    kind: Harvest['kind'],
    amounts: Partial<Pick<Harvest, 'fee0' | 'fee1' | 'fees' | 'feeMain0' | 'feeMain1' | 'feeAlt0' | 'feeAlt1'>>
): Harvest => ({
    ...eventColumns(event),
    strategy: asHex(event.srcAddress),
    kind,
    harvester: undefined,
    wantHarvested: undefined,
    tvl: undefined,
    fee0: amounts.fee0,
    fee1: amounts.fee1,
    fees: amounts.fees,
    feeMain0: amounts.feeMain0,
    feeMain1: amounts.feeMain1,
    feeAlt0: amounts.feeAlt0,
    feeAlt1: amounts.feeAlt1,
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'CLM_STRATEGY');
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'Harvest' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_STRATEGY'))) return;
    context.Harvest.set(harvestRow(event, 'CLM_HARVEST', { fee0: event.params.fee0, fee1: event.params.fee1 }));
    await writeClmPoolState(context, event);
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'HarvestRewards' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_STRATEGY'))) return;
    context.Harvest.set(harvestRow(event, 'CLM_HARVEST_REWARDS', { fees: event.params.fees }));
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'ClaimedFees' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_STRATEGY'))) return;
    context.Harvest.set(
        harvestRow(event, 'CLM_CLAIMED_FEES', {
            feeMain0: event.params.feeMain0,
            feeMain1: event.params.feeMain1,
            feeAlt0: event.params.feeAlt0,
            feeAlt1: event.params.feeAlt1,
        })
    );
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'ClaimedRewards' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_STRATEGY'))) return;
    context.Harvest.set(harvestRow(event, 'CLM_CLAIMED_REWARDS', { fees: event.params.fees }));
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'ChargedFees' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_STRATEGY'))) return;
    context.FeesCharged.set({
        ...eventColumns(event),
        strategy: asHex(event.srcAddress),
        family: 'CLM',
        version: 1,
        callFee: undefined,
        beefyFee: event.params.beefyFee,
        strategistFee: undefined,
        liquidityFee: event.params.liquidityFee,
    });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'ChargedFeesV2' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_STRATEGY'))) return;
    context.FeesCharged.set({
        ...eventColumns(event),
        strategy: asHex(event.srcAddress),
        family: 'CLM',
        version: 2,
        callFee: event.params.callFeeAmount,
        beefyFee: event.params.beefyFeeAmount,
        strategistFee: event.params.strategistFeeAmount,
        liquidityFee: undefined,
    });
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'TVL' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_STRATEGY'))) return;
    context.ClmTvl.set({
        ...eventColumns(event),
        strategy: asHex(event.srcAddress),
        bal0: event.params.bal0,
        bal1: event.params.bal1,
    });
    await writeClmPoolState(context, event);
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'Paused' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_STRATEGY'))) return;
    writePauseChange(context, event, true);
});

indexer.onEvent({ contract: 'ClmStrategy', event: 'Unpaused' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'CLM_STRATEGY'))) return;
    writePauseChange(context, event, false);
});
