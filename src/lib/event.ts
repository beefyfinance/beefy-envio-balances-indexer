import type { ChainId } from '@beefyfinance/blockchain-addressbook';
import type { EvmBlock } from 'envio';
import { type Bytes, toHex } from './hex';
export const eventId = ({
    chainId,
    trxHash,
    trxIndex,
    logIndex,
}: {
    chainId: ChainId;
    trxHash: Bytes;
    trxIndex: number;
    logIndex: number;
}) => `${chainId}-${toHex(trxHash)}-${trxIndex.toString()}-${logIndex.toString()}`;

export type EventMetadata = {
    block: EvmBlock;
    trxIndex: number;
    logIndex: number;
    trxHash: Bytes;
};

export const getEventFields = ({ chainId, event }: { chainId: ChainId; event: EventMetadata }) => ({
    id: eventId({
        chainId,
        trxHash: event.trxHash,
        trxIndex: event.trxIndex,
        logIndex: event.logIndex,
    }),
    trxHash: event.trxHash,
    trxIndex: event.trxIndex,
    logIndex: event.logIndex,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: new Date(event.block.timestamp * 1000),
});
