import type { ChainId } from '@beefyfinance/blockchain-addressbook';
import type { Hex } from 'viem';
import { interpretAsDecimal } from '../lib/decimal';
import type { Block, HandlerContext, PoolRewardedEvent_t, Token_t } from '../lib/schema';

const poolRewardedEventId = ({
    chainId,
    trxHash,
    trxIndex,
    logIndex,
}: {
    chainId: ChainId;
    trxHash: Hex;
    trxIndex: number;
    logIndex: number;
}) => `${chainId}-${trxHash.toLowerCase()}-${trxIndex.toString()}-${logIndex.toString()}`;

export const createPoolRewardedEvent = async ({
    context,
    chainId,
    poolShareToken,
    rewardToken,
    rewardVestingSeconds,
    rawRewardAmount,
    event,
}: {
    context: HandlerContext;
    chainId: ChainId;
    poolShareToken: Token_t;
    rewardToken: Token_t;
    rewardVestingSeconds: bigint;
    rawRewardAmount: bigint;
    event: {
        block: Block;
        trxIndex: number;
        logIndex: number;
        trxHash: Hex;
    };
}) => {
    const id = poolRewardedEventId({
        chainId,
        trxHash: event.trxHash,
        trxIndex: event.trxIndex,
        logIndex: event.logIndex,
    });

    const poolRewardedEvent: PoolRewardedEvent_t = {
        id,
        chainId,
        trxHash: event.trxHash,
        trxIndex: event.trxIndex,
        logIndex: event.logIndex,
        poolShareToken_id: poolShareToken.id,
        rewardToken_id: rewardToken.id,
        rewardAmount: interpretAsDecimal(rawRewardAmount, rewardToken.decimals),
        rewardVestingSeconds,
        blockNumber: BigInt(event.block.number),
        blockTimestamp: new Date(event.block.timestamp * 1000),
    };

    context.log.debug('Creating PoolRewardedEvent', poolRewardedEvent);

    const evt = await context.PoolRewardedEvent.get(id);
    if (evt) {
        throw new Error(`PoolRewardedEvent ${id} already exists`);
    }

    context.PoolRewardedEvent.set(poolRewardedEvent);
    return poolRewardedEvent;
};
