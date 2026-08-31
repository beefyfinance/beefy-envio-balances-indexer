import type { Account, Classic, ClassicPosition, EvmOnEventContext } from 'envio';
import type { Hex } from 'viem';
import { BIG_ZERO, type BigDecimal } from '../lib/decimal';
import { normalizeHex } from '../lib/hex';

export const classicPositionId = ({ classicId, accountAddress }: { classicId: string; accountAddress: Hex }) =>
    `${classicId}-${normalizeHex(accountAddress)}`;

export const getClassicPosition = async ({
    context,
    classicId,
    accountAddress,
}: {
    context: EvmOnEventContext;
    classicId: string;
    accountAddress: Hex;
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
    createdWithTrxHash?: Hex;
}): Promise<ClassicPosition> => {
    const id = classicPositionId({ classicId: classic.id, accountAddress: normalizeHex(account.address) });
    const existing = await context.ClassicPosition.get(id);
    if (existing) {
        return existing;
    }

    const position: ClassicPosition = {
        id,
        classic_id: classic.id,
        account_id: account.id,
        createdWithTrxHash:
            createdWithTrxHash ?? normalizeHex('0x0000000000000000000000000000000000000000000000000000000000000000'),
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
