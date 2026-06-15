import type { Clm, EvmOnEventContext, Token } from 'envio';
import type { Hex } from 'viem';
import { getTokenOrThrow } from '../../entities/token.entity';
import { toChainId } from '../chain';
import { normalizeHex } from '../hex';

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
        ...clm.outputToken_ids.map((id) => getTokenOrThrow({ context, id: id })),
        ...clm.rewardToken_ids.map((id) => getTokenOrThrow({ context, id: id })),
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
    blockNumber,
}: {
    clm: Clm;
    tokens: ClmTokens;
    blockNumber: number;
}) => {
    if (!clm.clmStrategy_id) {
        throw new Error(`CLM ${clm.id} has no linked strategy`);
    }

    const resolvedChainId = toChainId(clm.chainId);
    const strategyAddress = normalizeHex(clm.clmStrategy_id.slice(`${String(resolvedChainId)}-`.length));

    return {
        chainId: resolvedChainId,
        blockNumber,
        managerAddress: clm.address as Hex,
        strategyAddress: strategyAddress as Hex,
        underlyingToken0Address: tokens.underlyingToken0.address as Hex,
        underlyingToken1Address: tokens.underlyingToken1.address as Hex,
        underlyingToken0Decimals: tokens.underlyingToken0.decimals,
        underlyingToken1Decimals: tokens.underlyingToken1.decimals,
        rewardPoolTokenAddresses: clm.rewardPoolTokensOrder.map((a) => normalizeHex(a)),
        outputTokenAddresses: clm.outputTokensOrder.map((a) => normalizeHex(a)),
        rewardTokens: tokens.rewardTokens.map((token) => ({
            address: normalizeHex(token.address),
            decimals: token.decimals,
        })),
    };
};
