import type { Hex } from 'viem';
import { getTokenMetadata } from '../effects/token.effects';
import type { ChainId } from '../lib/chain';
import { BigDecimal } from '../lib/decimal';
import type { HandlerContext, Token_t } from '../lib/schema';

export const tokenId = ({ chainId, tokenAddress }: { chainId: ChainId; tokenAddress: Hex }) =>
    `${chainId}-${tokenAddress.toLowerCase()}`;

export const getOrCreateToken = async ({
    context,
    chainId,
    tokenAddress,
    virtual,
}: {
    context: HandlerContext;
    chainId: ChainId;
    tokenAddress: Hex;
    virtual:
        | false
        | {
              suffix: string;
              stakingToken: Hex;
          };
}): Promise<Token_t> => {
    context.log.debug('Getting or creating token', { chainId, tokenAddress, virtual });
    const id = tokenId({ chainId, tokenAddress });
    const maybeExistingToken = await context.Token.get(id);
    if (maybeExistingToken) {
        return maybeExistingToken;
    }

    let tokenMetadata: { name: string; symbol: string; decimals: number };
    let isVirtual = false;

    if (virtual === false) {
        tokenMetadata = await context.effect(getTokenMetadata, {
            tokenAddress: tokenAddress,
            chainId: chainId,
        });
        isVirtual = false;
    } else {
        isVirtual = true;
        const stakingTokenMetadata = await context.effect(getTokenMetadata, {
            tokenAddress: virtual.stakingToken,
            chainId: chainId,
        });
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

export const getTokenOrThrow = async ({ context, id }: { context: HandlerContext; id: string }): Promise<Token_t> => {
    const token = await context.Token.get(id);
    if (!token) {
        throw new Error(`Token ${id} not found`);
    }
    return token;
};
