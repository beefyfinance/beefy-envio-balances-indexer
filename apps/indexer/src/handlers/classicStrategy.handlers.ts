import { indexer } from 'envio';

import { eventColumns } from '../lib/event';
import { asHex } from '../lib/hex';
import { ensureContract } from '../lib/registry';
import { writePauseChange } from '../lib/rows';

indexer.onEvent({ contract: 'ClassicStrategy', event: 'Initialized' }, async ({ event, context }) => {
    await ensureContract(context, event, 'STRATEGY');
});

indexer.onEvent({ contract: 'ClassicStrategy', event: 'ChargedFees' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'STRATEGY'))) return;
    context.FeesCharged.set({
        ...eventColumns(event),
        strategy: asHex(event.srcAddress),
        family: 'CLASSIC',
        version: 1,
        callFee: undefined,
        beefyFee: event.params.beefyFee,
        strategistFee: undefined,
        liquidityFee: event.params.liquidityFee,
    });
});

indexer.onEvent({ contract: 'ClassicStrategy', event: 'ChargedFeesV2' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'STRATEGY'))) return;
    context.FeesCharged.set({
        ...eventColumns(event),
        strategy: asHex(event.srcAddress),
        family: 'CLASSIC',
        version: 2,
        callFee: event.params.callFees,
        beefyFee: event.params.beefyFees,
        strategistFee: event.params.strategistFees,
        liquidityFee: undefined,
    });
});

indexer.onEvent({ contract: 'ClassicStrategy', event: 'Paused' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'STRATEGY'))) return;
    writePauseChange(context, event, true);
});

indexer.onEvent({ contract: 'ClassicStrategy', event: 'Unpaused' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'STRATEGY'))) return;
    writePauseChange(context, event, false);
});

const stratHarvestRow = (event: {
    srcAddress: string;
    params: { harvester: string; wantHarvested: bigint; tvl: bigint };
}) => ({
    strategy: asHex(event.srcAddress),
    kind: 'CLASSIC_STRAT_HARVEST' as const,
    harvester: asHex(event.params.harvester),
    wantHarvested: event.params.wantHarvested,
    tvl: event.params.tvl,
    fee0: undefined,
    fee1: undefined,
    fees: undefined,
    feeMain0: undefined,
    feeMain1: undefined,
    feeAlt0: undefined,
    feeAlt1: undefined,
});

indexer.onEvent({ contract: 'ClassicStrategyStratHarvest0', event: 'StratHarvest' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'STRATEGY'))) return;
    context.Harvest.set({ ...eventColumns(event), ...stratHarvestRow(event) });
});

indexer.onEvent({ contract: 'ClassicStrategyStratHarvest1', event: 'StratHarvest' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'STRATEGY'))) return;
    context.Harvest.set({ ...eventColumns(event), ...stratHarvestRow(event) });
});
