import type { Account, Classic, ClassicPosition, EvmOnEventContext } from 'envio';
import { BIG_ZERO, type BigDecimal } from '../lib/decimal';
import { type Bytes, toHex, ZERO_HASH } from '../lib/hex';
export const classicPositionId = ({ classicId, accountAddress }: { classicId: string; accountAddress: Bytes }) =>
    `${classicId}-${toHex(accountAddress)}`;

export const getClassicPosition = async ({
    context,
    classicId,
    accountAddress,
}: {
    context: EvmOnEventContext;
    classicId: string;
    accountAddress: Bytes;
}) => {
    const id = classicPositionId({ classicId, accountAddress });
    return await context.ClassicPosition.get(id);
};

export const getOrCreateClassicPosition = async ({
    context,
    classic,
    account,
    createdWithTrxHash,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    account: Account;
    createdWithTrxHash?: Bytes;
}): Promise<ClassicPosition> => {
    const id = classicPositionId({ classicId: classic.id, accountAddress: account.address });
    const existing = await context.ClassicPosition.get(id);
    if (existing) {
        return existing;
    }

    const position: ClassicPosition = {
        id,
        classic_id: classic.id,
        account_id: account.id,
        createdWithTrxHash: createdWithTrxHash ?? ZERO_HASH,
        vaultBalance: BIG_ZERO,
        boostBalance: BIG_ZERO,
        rewardPoolBalances: [],
        erc4626AdapterBalances: [],
        erc4626AdapterVaultSharesBalances: [],
        totalBalance: BIG_ZERO,
    };

    context.ClassicPosition.set(position);
    return position;
};

export const updateClassicPositionBalances = async ({
    context,
    position,
    vaultBalance,
    boostBalance,
    rewardPoolBalances,
    erc4626AdapterBalances,
    erc4626AdapterVaultSharesBalances,
}: {
    context: EvmOnEventContext;
    position: ClassicPosition;
    vaultBalance: BigDecimal;
    boostBalance: BigDecimal;
    rewardPoolBalances: BigDecimal[];
    erc4626AdapterBalances: BigDecimal[];
    erc4626AdapterVaultSharesBalances: BigDecimal[];
}) => {
    let totalBalance = vaultBalance.plus(boostBalance);
    for (const balance of rewardPoolBalances) {
        totalBalance = totalBalance.plus(balance);
    }
    for (const balance of erc4626AdapterVaultSharesBalances) {
        totalBalance = totalBalance.plus(balance);
    }

    context.ClassicPosition.set({
        ...position,
        vaultBalance,
        boostBalance,
        rewardPoolBalances,
        erc4626AdapterBalances,
        erc4626AdapterVaultSharesBalances,
        totalBalance,
    });
};
