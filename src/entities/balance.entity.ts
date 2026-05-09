import type { Account, EvmBlock, EvmChainId, EvmOnEventContext, Token, TokenBalance } from 'envio';
import type { Hex } from 'viem';
import { BigDecimal } from '../lib/decimal';
import { normalizeHex } from '../lib/hex';
import { accountId } from './account.entity';
import { tokenId } from './token.entity';

export const tokenBalanceId = ({ chainId, account, token }: { chainId: EvmChainId; account: Account; token: Token }) =>
    `${chainId}-${normalizeHex(account.address)}-${normalizeHex(token.address)}`;

export const TokenBalanceChangeId = ({
    chainId,
    account,
    token,
    blockNumber,
    trxIndex,
    logIndex,
}: {
    chainId: EvmChainId;
    account: Account;
    token: Token;
    blockNumber: number;
    trxIndex: number;
    logIndex: number;
}) =>
    `${chainId}-${normalizeHex(account.address)}-${normalizeHex(token.address)}-${blockNumber}-${trxIndex}-${logIndex}`;

export const getOrCreateTokenBalanceEntity = async ({
    context,
    token,
    account,
    chainId,
}: {
    context: EvmOnEventContext;
    account: Account;
    token: Token;
    chainId: EvmChainId;
}): Promise<TokenBalance> => {
    return await context.TokenBalance.getOrCreate({
        id: tokenBalanceId({ chainId, account, token }),

        chainId: chainId,

        account_id: accountId({ accountAddress: account.address as Hex }),
        token_id: tokenId({ chainId, tokenAddress: token.address as Hex }),

        amount: new BigDecimal(0),
    });
};

export const getOrCreateTokenBalanceChangeEntity = async ({
    context,
    token,
    account,
    balanceBefore,
    balanceAfter,
    chainId,
    event,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    token: Token;
    account: Account;
    event: {
        block: EvmBlock;
        trxIndex: number;
        logIndex: number;
        trxHash: Hex;
    };
    balanceBefore: InstanceType<typeof BigDecimal>;
    balanceAfter: InstanceType<typeof BigDecimal>;
}) => {
    return await context.TokenBalanceChange.getOrCreate({
        id: TokenBalanceChangeId({
            chainId,
            account,
            token,
            blockNumber: event.block.number,
            trxIndex: event.trxIndex,
            logIndex: event.logIndex,
        }),

        chainId: chainId,

        tokenBalance_id: tokenBalanceId({ chainId, account, token }),
        account_id: accountId({ accountAddress: account.address as Hex }),
        token_id: tokenId({ chainId, tokenAddress: token.address as Hex }),

        balanceBefore,
        balanceAfter,

        trxIndex: event.trxIndex,
        trxHash: event.trxHash,
        logIndex: event.logIndex,
        blockNumber: BigInt(event.block.number),
        blockTimestamp: new Date(event.block.timestamp * 1000),
    });
};
