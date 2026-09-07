import type { Account, Clm, ClmPosition, EvmOnEventContext } from 'envio';
import { BIG_ZERO, type BigDecimal } from '../lib/decimal';
import { type Bytes, toHex, ZERO_HASH } from '../lib/hex';
export const clmPositionId = ({ clmId, accountAddress }: { clmId: string; accountAddress: Bytes }) =>
    `${clmId}-${toHex(accountAddress)}`;

export const getClmPosition = async ({
    context,
    clmId,
    accountAddress,
}: {
    context: EvmOnEventContext;
    clmId: string;
    accountAddress: Bytes;
}) => {
    const id = clmPositionId({ clmId, accountAddress });
    return await context.ClmPosition.get(id);
};

export const getOrCreateClmPosition = async ({
    context,
    clm,
    account,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    account: Account;
}): Promise<ClmPosition> => {
    const id = clmPositionId({ clmId: clm.id, accountAddress: account.address });
    const existing = await context.ClmPosition.get(id);
    if (existing) {
        return existing;
    }

    const position: ClmPosition = {
        id,
        clm_id: clm.id,
        account_id: account.id,
        createdWithTrxHash: ZERO_HASH,
        managerBalance: BIG_ZERO,
        rewardPoolBalances: [],
        totalBalance: BIG_ZERO,
    };

    context.ClmPosition.set(position);
    return position;
};

export const updateClmPositionBalances = async ({
    context,
    position,
    managerBalance,
    rewardPoolBalances,
}: {
    context: EvmOnEventContext;
    position: ClmPosition;
    managerBalance: BigDecimal;
    rewardPoolBalances: BigDecimal[];
}) => {
    let totalBalance = managerBalance;
    for (const balance of rewardPoolBalances) {
        totalBalance = totalBalance.plus(balance);
    }

    context.ClmPosition.set({
        ...position,
        managerBalance,
        rewardPoolBalances,
        totalBalance,
    });
};
