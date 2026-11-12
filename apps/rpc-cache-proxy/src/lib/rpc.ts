import { z } from 'zod';

/** What an upstream answered: its status and body, untouched. */
export type Answer = { status: number; text: string };

export const parseJson = (text: string): unknown => {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
};

/** A single JSON-RPC request; batches and anything else do not match and are forwarded as received. */
export const requestSchema = z.looseObject({
    id: z.unknown(),
    method: z.string(),
    params: z.array(z.unknown()).default([]),
});

const envelope = z.looseObject({ result: z.unknown().optional() });
const idOf = z.looseObject({ id: z.unknown() });

/** The `result` of a JSON-RPC answer body, or undefined. */
export const resultOf = (text: string): unknown => {
    const parsed = envelope.safeParse(parseJson(text));
    return parsed.success ? parsed.data.result : undefined;
};

/** The body with its `id` set to `id`, unless it has that id already. */
export const withId = (text: string, id: unknown): string => {
    const parsed = idOf.safeParse(parseJson(text));
    return parsed.success && parsed.data.id !== id ? JSON.stringify({ ...parsed.data, id }) : text;
};

export const logSchema = z.looseObject({
    address: z.string(),
    topics: z.array(z.string()),
    data: z.string(),
    blockNumber: z.string(),
    transactionHash: z.string(),
    transactionIndex: z.string(),
    blockHash: z.string(),
    logIndex: z.string(),
});
export type RpcLog = z.infer<typeof logSchema>;

/** The fields the indexer reads from a log, nothing the node adds. */
export const cleanLog = (log: RpcLog): RpcLog & { removed: false } => ({
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    blockHash: log.blockHash,
    logIndex: log.logIndex,
    removed: false,
});

export const logsResult = z.array(logSchema);

const addressList = z.union([z.string(), z.array(z.string())]);
const topicSlot = z.union([z.string(), z.array(z.string()), z.null()]);
export const filterSchema = z.looseObject({
    address: addressList.optional(),
    topics: z.array(topicSlot).optional(),
    fromBlock: z.string().optional(),
    toBlock: z.string().optional(),
    blockHash: z.string().optional(),
});

export const blockResult = z.looseObject({ hash: z.string().nullish() });
export const transactionResult = z.looseObject({ blockNumber: z.string().nullish() });
