/** BeefySwapper routes and configuration, from events only. */

import { type EvmOnEventContext, indexer, type SwapperConfigChange } from 'envio';

import { eventColumns, type RawEvent } from '../lib/event';
import { asHex } from '../lib/hex';
import { ensureContract, ensureToken } from '../lib/registry';

const writeConfigChange = (
    context: EvmOnEventContext,
    event: RawEvent,
    change: Pick<SwapperConfigChange, 'kind' | 'oracle' | 'slippage' | 'version'>
) => {
    context.SwapperConfigChange.set({ ...eventColumns(event), swapper: asHex(event.srcAddress), ...change });
};

indexer.onEvent({ contract: 'BeefySwapper', event: 'Initialized' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'SWAPPER'))) return;
    writeConfigChange(context, event, {
        kind: 'INITIALIZED',
        oracle: undefined,
        slippage: undefined,
        version: Number(event.params.version),
    });
});

indexer.onEvent({ contract: 'BeefySwapper', event: 'SetOracle' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'SWAPPER'))) return;
    writeConfigChange(context, event, {
        kind: 'SET_ORACLE',
        oracle: asHex(event.params.oracle),
        slippage: undefined,
        version: undefined,
    });
});

indexer.onEvent({ contract: 'BeefySwapper', event: 'SetSlippage' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'SWAPPER'))) return;
    writeConfigChange(context, event, {
        kind: 'SET_SLIPPAGE',
        oracle: undefined,
        slippage: event.params.slippage,
        version: undefined,
    });
});

indexer.onEvent({ contract: 'BeefySwapper', event: 'SetSwapInfo' }, async ({ event, context }) => {
    if (!(await ensureContract(context, event, 'SWAPPER'))) return;
    const swapper = asHex(event.srcAddress);
    const fromToken = asHex(event.params.fromToken);
    const toToken = asHex(event.params.toToken);
    await Promise.all([
        ensureToken(context, event.chainId, fromToken, false),
        ensureToken(context, event.chainId, toToken, false),
    ]);
    const { swapInfo } = event.params;
    const route = {
        swapper,
        fromToken,
        toToken,
        router: asHex(swapInfo.router),
        data: asHex(swapInfo.data),
        amountIndex: swapInfo.amountIndex,
        minIndex: swapInfo.minIndex,
        minAmountSign: Number(swapInfo.minAmountSign),
    };
    const columns = eventColumns(event);
    context.SwapperRoute.set({
        ...route,
        id: `${event.chainId}-${swapper}-${fromToken}-${toToken}`,
        updatedBlock: columns.blockNumber,
        updatedTimestamp: columns.blockTimestamp,
        updatedTrxHash: columns.trxHash,
    });
    context.SwapperRouteChange.set({ ...columns, ...route });
});
