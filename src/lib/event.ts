import { asHex } from './hex';

/** The subset of an Envio event every row writer needs (config `field_selection`: transaction hash + from). */
export type RawEvent = {
    chainId: number;
    srcAddress: string;
    logIndex: number;
    block: { number: number; timestamp: number };
    transaction: { hash: string; from?: string | undefined };
};

export const contractId = (chainId: number, address: string) => `${chainId}-${asHex(address)}`;

/** Deterministic event id: `chainId-trxHash-logIndex`. */
export const eventId = (event: RawEvent) => `${event.chainId}-${asHex(event.transaction.hash)}-${event.logIndex}`;

export const blockTimestamp = (event: Pick<RawEvent, 'block'>) => new Date(event.block.timestamp * 1000);

/** Columns shared by every event row. */
export const eventColumns = (event: RawEvent) => ({
    id: eventId(event),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: blockTimestamp(event),
    trxHash: asHex(event.transaction.hash),
    trxFrom: event.transaction.from === undefined ? undefined : asHex(event.transaction.from),
    logIndex: event.logIndex,
});
