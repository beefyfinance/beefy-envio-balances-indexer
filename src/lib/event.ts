import type { ChainId } from '@beefyfinance/blockchain-addressbook';
import type { EvmBlock } from 'envio';
import type { Hex } from 'viem';
import { normalizeHex } from './hex';

export const eventId = ({
    chainId,
    trxHash,
    trxIndex,
    logIndex,
}: {
    chainId: ChainId;
    trxHash: Hex;
    trxIndex: number;
    logIndex: number;
}) => `${chainId}-${normalizeHex(trxHash)}-${trxIndex.toString()}-${logIndex.toString()}`;

export type EventMetadata = {
    block: EvmBlock;
    trxIndex: number;
    logIndex: number;
    trxHash: Hex;
};

export const getEventFields = ({ chainId, event }: { chainId: ChainId; event: EventMetadata }) => ({
    id: eventId({
        chainId,
        trxHash: event.trxHash,
        trxIndex: event.trxIndex,
        logIndex: event.logIndex,
    }),
    chainId,
    trxHash: event.trxHash,
    trxIndex: event.trxIndex,
    logIndex: event.logIndex,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: new Date(event.block.timestamp * 1000),
});
