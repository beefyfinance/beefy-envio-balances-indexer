import type { ChainId } from '@beefyfinance/blockchain-addressbook';
import type { EvmBlock, EvmOnEventContext, PoolRewardedEvent, Token } from 'envio';
import type { Hex } from 'viem';
import { interpretAsDecimal } from '../lib/decimal';
import { normalizeHex } from '../lib/hex';

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
}) => `${chainId}-${normalizeHex(trxHash)}-${trxIndex.toString()}-${logIndex.toString()}`;

export const createPoolRewardedEvent = async ({
    context,
    chainId,
    poolShareToken,
    rewardToken,
    rewardVestingSeconds,
    rawRewardAmount,
    event,
}: {
    context: EvmOnEventContext;
    chainId: ChainId;
    poolShareToken: Token;
    rewardToken: Token;
    rewardVestingSeconds: bigint;
    rawRewardAmount: bigint;
    event: {
        block: EvmBlock;
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

    const poolRewardedEvent: PoolRewardedEvent = {
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
