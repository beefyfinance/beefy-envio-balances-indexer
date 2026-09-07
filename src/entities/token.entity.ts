import type { EvmChainId, EvmOnEventContext, Token } from 'envio';
import { getTokenMetadata } from '../effects/token.effects';
import { BigDecimal } from '../lib/decimal';
import { type Bytes, toHex } from '../lib/hex';
export const tokenId = ({ chainId, tokenAddress }: { chainId: EvmChainId; tokenAddress: Bytes }) =>
    `${chainId}-${toHex(tokenAddress)}`;

export const getOrCreateToken = async ({
    context,
    chainId,
    tokenAddress,
    virtual,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    tokenAddress: Bytes;
    virtual:
        | false
        | {
              suffix: string;
              stakingToken: Bytes;
          };
}): Promise<Token | null> => {
    context.log.debug('Getting or creating token', { chainId, tokenAddress: tokenAddress, virtual });
    const id = tokenId({ chainId, tokenAddress });
    const maybeExistingToken = await context.Token.get(id);
    if (maybeExistingToken) {
        return maybeExistingToken;
    }

    let tokenMetadata: { name: string; symbol: string; decimals: number };
    let isVirtual = false;

    if (virtual === false) {
        const result = await context.effect(getTokenMetadata, {
            tokenAddress: toHex(tokenAddress),
            chainId: chainId,
        });
        if (result.status === 'invalid') {
            context.log.error('[INVALID_TOKEN] skipping token creation', {
                chainId,
                tokenAddress: tokenAddress,
            });
            return null;
        }
        tokenMetadata = { name: result.name, symbol: result.symbol, decimals: result.decimals };
        isVirtual = false;
    } else {
        isVirtual = true;
        const stakingTokenStr = toHex(virtual.stakingToken);
        const stakingTokenMetadata = await context.effect(getTokenMetadata, {
            tokenAddress: stakingTokenStr,
            chainId: chainId,
        });
        if (stakingTokenMetadata.status === 'invalid') {
            context.log.error('[INVALID_TOKEN] skipping virtual token creation (staking token invalid)', {
                chainId,
                tokenAddress: tokenAddress,
                stakingToken: stakingTokenStr,
            });
            return null;
        }
        tokenMetadata = {
            name: `${stakingTokenMetadata.name} ${virtual.suffix}`,
            symbol: `${stakingTokenMetadata.symbol} ${virtual.suffix}`,
            decimals: stakingTokenMetadata.decimals,
        };
    }

    return await context.Token.getOrCreate({
        id,
        address: tokenAddress,
        isVirtual,

        name: tokenMetadata.name,
        symbol: tokenMetadata.symbol,
        decimals: tokenMetadata.decimals,

        totalSupply: new BigDecimal(0),

        holderCount: 0,
    });
};

export const getTokenOrThrow = async ({ context, id }: { context: EvmOnEventContext; id: string }): Promise<Token> => {
    const token = await context.Token.get(id);
    if (!token) {
        throw new Error(`Token ${id} not found`);
    }
    return token;
};
