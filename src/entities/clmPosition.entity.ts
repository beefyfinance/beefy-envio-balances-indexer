import type { Account, Clm, ClmPosition, EvmOnEventContext } from 'envio';
import type { Hex } from 'viem';
import { BIG_ZERO, type BigDecimal } from '../lib/decimal';
import { normalizeHex } from '../lib/hex';

export const clmPositionId = ({ clmId, accountAddress }: { clmId: string; accountAddress: Hex }) =>
    `${clmId}-${normalizeHex(accountAddress)}`;

export const getClmPosition = async ({
    context,
    clmId,
    accountAddress,
}: {
    context: EvmOnEventContext;
    clmId: string;
    accountAddress: Hex;
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
    const id = clmPositionId({ clmId: clm.id, accountAddress: normalizeHex(account.address) });
    const existing = await context.ClmPosition.get(id);
    if (existing) {
        return existing;
    }

    const position: ClmPosition = {
        id,
        chainId: clm.chainId,
        clm_id: clm.id,
        account_id: account.id,
        createdWithTrxHash: normalizeHex('0x0000000000000000000000000000000000000000000000000000000000000000'),
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
