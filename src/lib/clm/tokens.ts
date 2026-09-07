import type { Clm, EvmChainId, EvmOnEventContext, Token } from 'envio';
import { getTokenOrThrow } from '../../entities/token.entity';
import { asHex, toBytes, toHex } from '../hex';
export const loadClmTokens = async ({
    context,
    clm,
}: {
    context: EvmOnEventContext;
    clm: Clm;
}): Promise<{
    managerToken: Token;
    underlyingToken0: Token;
    underlyingToken1: Token;
    rewardPoolTokens: Token[];
    outputTokens: Token[];
    rewardTokens: Token[];
}> => {
    const [managerToken, underlyingToken0, underlyingToken1, ...rest] = await Promise.all([
        getTokenOrThrow({ context, id: clm.managerToken_id }),
        getTokenOrThrow({ context, id: clm.underlyingToken0_id }),
        getTokenOrThrow({ context, id: clm.underlyingToken1_id }),
        ...clm.rewardPoolToken_ids.map((id) => getTokenOrThrow({ context, id })),
        ...clm.outputToken_ids.map((id) => getTokenOrThrow({ context, id })),
        ...clm.rewardToken_ids.map((id) => getTokenOrThrow({ context, id })),
    ]);

    const rewardPoolCount = clm.rewardPoolToken_ids.length;
    const outputCount = clm.outputToken_ids.length;

    const rewardPoolTokens = rest.slice(0, rewardPoolCount) as Token[];
    const outputTokens = rest.slice(rewardPoolCount, rewardPoolCount + outputCount) as Token[];
    const rewardTokens = rest.slice(rewardPoolCount + outputCount) as Token[];

    return {
        managerToken,
        underlyingToken0,
        underlyingToken1,
        rewardPoolTokens,
        outputTokens,
        rewardTokens,
    };
};

export type ClmTokens = Awaited<ReturnType<typeof loadClmTokens>>;

export const buildClmFetchInput = ({
    clm,
    tokens,
    chainId,
    blockNumber,
}: {
    clm: Clm;
    tokens: ClmTokens;
    chainId: EvmChainId;
    blockNumber: number;
}) => {
    if (!clm.clmStrategy_id) {
        throw new Error(`CLM ${clm.id} has no linked strategy`);
    }

    const strategyAddress = toBytes(clm.clmStrategy_id.slice(`${String(chainId)}-`.length));

    return {
        chainId,
        blockNumber,
        managerAddress: toHex(clm.address),
        strategyAddress: toHex(strategyAddress),
        underlyingToken0Address: toHex(tokens.underlyingToken0.address),
        underlyingToken1Address: toHex(tokens.underlyingToken1.address),
        underlyingToken0Decimals: tokens.underlyingToken0.decimals,
        underlyingToken1Decimals: tokens.underlyingToken1.decimals,
        rewardPoolTokenAddresses: clm.rewardPoolTokensOrder.map(asHex),
        outputTokenAddresses: clm.outputTokensOrder.map(asHex),
        rewardTokens: tokens.rewardTokens.map((token) => ({
            address: toHex(token.address),
            decimals: token.decimals,
        })),
    };
};
