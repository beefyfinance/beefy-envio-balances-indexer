import type { EvmChainId, EvmOnEventContext, Token } from 'envio';
import type { Hex } from 'viem';
import { getTokenMetadata } from '../effects/token.effects';
import { BigDecimal } from '../lib/decimal';
import { normalizeHex } from '../lib/hex';

export const tokenId = ({ chainId, tokenAddress }: { chainId: EvmChainId; tokenAddress: Hex }) =>
    `${chainId}-${normalizeHex(tokenAddress)}`;

export const getOrCreateToken = async ({
    context,
    chainId,
    tokenAddress,
    virtual,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    tokenAddress: Hex;
    virtual:
        | false
        | {
              suffix: string;
              stakingToken: Hex;
          };
}): Promise<Token | null> => {
    context.log.debug('Getting or creating token', { chainId, tokenAddress, virtual });
    const id = tokenId({ chainId, tokenAddress });
    const maybeExistingToken = await context.Token.get(id);
    if (maybeExistingToken) {
        return maybeExistingToken;
    }

    let tokenMetadata: { name: string; symbol: string; decimals: number };
    let isVirtual = false;

    if (virtual === false) {
        const result = await context.effect(getTokenMetadata, {
            tokenAddress: tokenAddress,
            chainId: chainId,
        });
        if (result.status === 'invalid') {
            context.log.error('[INVALID_TOKEN] skipping token creation', { chainId, tokenAddress });
            return null;
        }
        tokenMetadata = { name: result.name, symbol: result.symbol, decimals: result.decimals };
        isVirtual = false;
    } else {
        isVirtual = true;
        const stakingTokenMetadata = await context.effect(getTokenMetadata, {
            tokenAddress: virtual.stakingToken,
            chainId: chainId,
        });
        if (stakingTokenMetadata.status === 'invalid') {
            context.log.error('[INVALID_TOKEN] skipping virtual token creation (staking token invalid)', {
                chainId,
                tokenAddress,
                stakingToken: virtual.stakingToken,
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
        chainId,
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
