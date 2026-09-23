import type { ChainId } from '@beefyfinance/blockchain-addressbook';
import type { EvmOnEventContext, Swapper, SwapperRoute, Token } from 'envio';
import { type EventMetadata, getEventFields } from '../lib/event';
import { type Bytes, toHex } from '../lib/hex';

export const swapperId = ({ chainId, address }: { chainId: ChainId; address: Bytes }) => `${chainId}-${toHex(address)}`;

const emptySwapper = ({ id, address }: { id: string; address: Bytes }): Swapper => ({
    id,
    address,
    oracle: undefined,
    oracleTrxHash: undefined,
    slippage: undefined,
    slippageTrxHash: undefined,
});

export const getOrCreateSwapper = async ({
    context,
    chainId,
    address,
}: {
    context: EvmOnEventContext;
    chainId: ChainId;
    address: Bytes;
}): Promise<Swapper> => {
    const id = swapperId({ chainId, address });
    const existing = await context.Swapper.get(id);
    if (existing) {
        return existing;
    }

    const swapper = emptySwapper({ id, address });
    context.Swapper.set(swapper);
    return swapper;
};

export const applyInitializedConfig = async ({
    context,
    chainId,
    swapperAddress,
    oracle,
    slippage,
    event,
}: {
    context: EvmOnEventContext;
    chainId: ChainId;
    swapperAddress: Bytes;
    oracle: Bytes;
    slippage: bigint;
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });
    const swapper = await getOrCreateSwapper({ context, chainId, address: swapperAddress });
    context.Swapper.set({
        ...swapper,
        oracle,
        oracleTrxHash: fields.trxHash,
        slippage,
        slippageTrxHash: fields.trxHash,
    });
};

export const applySetOracle = async ({
    context,
    chainId,
    swapperAddress,
    oracle,
    event,
}: {
    context: EvmOnEventContext;
    chainId: ChainId;
    swapperAddress: Bytes;
    oracle: Bytes;
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });
    const swapper = await getOrCreateSwapper({ context, chainId, address: swapperAddress });
    context.Swapper.set({
        ...swapper,
        oracle,
        oracleTrxHash: fields.trxHash,
    });
};

export const applySetSlippage = async ({
    context,
    chainId,
    swapperAddress,
    slippage,
    event,
}: {
    context: EvmOnEventContext;
    chainId: ChainId;
    swapperAddress: Bytes;
    slippage: bigint;
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });
    const swapper = await getOrCreateSwapper({ context, chainId, address: swapperAddress });
    context.Swapper.set({
        ...swapper,
        slippage,
        slippageTrxHash: fields.trxHash,
    });
};

export const swapperRouteId = ({
    chainId,
    fromToken,
    toToken,
}: {
    chainId: ChainId;
    fromToken: Bytes;
    toToken: Bytes;
}) => `${chainId}-${toHex(fromToken)}-${toHex(toToken)}`;

export const applySetSwapInfo = async ({
    context,
    chainId,
    swapper,
    fromToken,
    toToken,
    router,
    data,
    amountIndex,
    minIndex,
    minAmountSign,
    event,
}: {
    context: EvmOnEventContext;
    chainId: ChainId;
    swapper: Swapper;
    fromToken: Token;
    toToken: Token;
    router: Bytes;
    data: Bytes;
    amountIndex: bigint;
    minIndex: bigint;
    minAmountSign: number;
    event: EventMetadata;
}) => {
    const fields = getEventFields({ chainId, event });
    const route: SwapperRoute = {
        id: swapperRouteId({ chainId, fromToken: fromToken.address, toToken: toToken.address }),
        swapper_id: swapper.id,
        fromToken_id: fromToken.id,
        toToken_id: toToken.id,
        router,
        data,
        amountIndex,
        minIndex,
        minAmountSign,
        trxHash: fields.trxHash,
        blockNumber: fields.blockNumber,
        blockTimestamp: fields.blockTimestamp,
    };
    context.SwapperRoute.set(route);
};
