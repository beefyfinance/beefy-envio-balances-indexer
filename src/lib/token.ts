import type { BigDecimal, Block_t, handlerContext as HandlerContext } from 'generated';
import type { Account_t, Token_t, TokenBalance_t } from 'generated/src/db/Entities.gen';
import type { Hex } from 'viem';
import { getOrCreateAccount } from '../entities/account.entity';
import { getOrCreateTokenBalanceChangeEntity, getOrCreateTokenBalanceEntity } from '../entities/balance.entity';
import type { ChainId } from './chain';
import { config } from './config';
import { BIG_ZERO, interpretAsDecimal } from './decimal';

export const handleTokenTransfer = async ({
    context,
    chainId,
    token,
    senderAddress,
    receiverAddress,
    rawTransferAmount,
    event,
}: {
    context: HandlerContext;
    chainId: ChainId;
    token: Token_t;
    senderAddress: Hex;
    receiverAddress: Hex;
    rawTransferAmount: bigint;
    event: {
        block: Block_t;
        logIndex: number;
        trxHash: Hex;
    };
}) => {
    if (rawTransferAmount === 0n) {
        context.log.debug('Ignoring transfer with zero value', { trx: event.trxHash });
        return;
    }

    const [senderAccount, receiverAccount] = await Promise.all([
        getOrCreateAccount({
            context,
            chainId,
            accountAddress: senderAddress,
        }),
        getOrCreateAccount({
            context,
            chainId,
            accountAddress: receiverAddress,
        }),
    ]);

    const [senderBalance, receiverBalance] = await Promise.all([
        senderAccount
            ? getOrCreateTokenBalanceEntity({
                  context,
                  token,
                  account: senderAccount,
                  chainId,
              })
            : null,
        receiverAccount
            ? getOrCreateTokenBalanceEntity({
                  context,
                  token,
                  account: receiverAccount,
                  chainId,
              })
            : null,
    ]);

    const value = interpretAsDecimal(rawTransferAmount, token.decimals);

    let holderCountChange = 0;
    let totalSupplyChange = BIG_ZERO;

    const isSelfTransfer = senderAddress === receiverAddress;

    if (isSelfTransfer && senderAccount && senderBalance) {
        // Same account: apply a single no-op balance update so we record the transfer
        // without double-applying or incorrectly changing holderCount
        await updateAccountBalance({
            context,
            chainId,
            amountDiff: BIG_ZERO,
            account: senderAccount,
            balance: senderBalance,
            token,
            event,
        });
    } else {
        if (senderAccount && senderBalance) {
            const diff = await updateAccountBalance({
                context,
                chainId,
                amountDiff: value.negated(),
                account: senderAccount,
                balance: senderBalance,
                token,
                event,
            });
            holderCountChange += diff.holderCountChange;
        }

        if (receiverAccount && receiverBalance) {
            const diff = await updateAccountBalance({
                context,
                chainId,
                amountDiff: value,
                account: receiverAccount,
                balance: receiverBalance,
                token,
                event,
            });
            holderCountChange += diff.holderCountChange;
        }
    }

    if (senderAddress === config.MINT_ADDRESS || senderAddress === config.BURN_ADDRESS) {
        totalSupplyChange = totalSupplyChange.plus(value);
    }
    if (receiverAddress === config.BURN_ADDRESS || receiverAddress === config.MINT_ADDRESS) {
        totalSupplyChange = totalSupplyChange.minus(value);
    }

    context.Token.set({
        ...token,
        holderCount: token.holderCount + holderCountChange,
        totalSupply: token.totalSupply.plus(totalSupplyChange),
    });
};

const updateAccountBalance = async ({
    context,
    amountDiff,
    account,
    balance,
    token,
    event,
    chainId,
}: {
    context: HandlerContext;
    amountDiff: BigDecimal;
    account: Account_t;
    balance: TokenBalance_t;
    token: Token_t;
    chainId: ChainId;
    event: {
        block: Block_t;
        logIndex: number;
        trxHash: Hex;
    };
}) => {
    const balanceBefore = balance.amount;
    const balanceAfter = balance.amount.plus(amountDiff);

    context.TokenBalance.set({
        ...balance,
        amount: balanceAfter,
    });

    await getOrCreateTokenBalanceChangeEntity({
        context,
        token,
        account,
        event,
        balanceBefore,
        balanceAfter,
        chainId,
    });

    let holderCountChange = 0;
    if (balanceBefore.eq(BIG_ZERO) && !balanceAfter.eq(BIG_ZERO)) {
        holderCountChange = 1;
    }
    if (!balanceBefore.eq(BIG_ZERO) && balanceAfter.eq(BIG_ZERO)) {
        holderCountChange = -1;
    }

    return {
        balanceBefore,
        balanceAfter,
        holderCountChange,
    };
};
