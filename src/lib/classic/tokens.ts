import type { Classic, EvmChainId, EvmOnEventContext, Token } from 'envio';
import { getTokenOrThrow } from '../../entities/token.entity';
import { asHex, type Bytes, toBytes, toHex, ZERO_ADDRESS } from '../hex';
export const loadClassicTokens = async ({
    context,
    classic,
}: {
    context: EvmOnEventContext;
    classic: Classic;
}): Promise<{
    vaultToken: Token;
    underlyingToken: Token;
    underlyingBreakdownTokens: Token[];
    rewardPoolTokens: Token[];
    boostRewardTokens: Token[];
    rewardTokens: Token[];
    erc4626AdapterTokens: Token[];
}> => {
    const [vaultToken, underlyingToken, ...rest] = await Promise.all([
        getTokenOrThrow({ context, id: classic.vaultToken_id }),
        getTokenOrThrow({ context, id: classic.underlyingToken_id }),
        ...classic.underlyingBreakdownToken_ids.map((id) => getTokenOrThrow({ context, id })),
        ...classic.rewardPoolToken_ids.map((id) => getTokenOrThrow({ context, id })),
        ...classic.boostRewardToken_ids.map((id) => getTokenOrThrow({ context, id })),
        ...classic.rewardToken_ids.map((id) => getTokenOrThrow({ context, id })),
        ...classic.erc4626AdapterToken_ids.map((id) => getTokenOrThrow({ context, id })),
    ]);

    let offset = 0;
    const underlyingBreakdownCount = classic.underlyingBreakdownToken_ids.length;
    const rewardPoolCount = classic.rewardPoolToken_ids.length;
    const boostRewardCount = classic.boostRewardToken_ids.length;
    const rewardTokenCount = classic.rewardToken_ids.length;

    const underlyingBreakdownTokens = rest.slice(offset, offset + underlyingBreakdownCount) as Token[];
    offset += underlyingBreakdownCount;
    const rewardPoolTokens = rest.slice(offset, offset + rewardPoolCount) as Token[];
    offset += rewardPoolCount;
    const boostRewardTokens = rest.slice(offset, offset + boostRewardCount) as Token[];
    offset += boostRewardCount;
    const rewardTokens = rest.slice(offset, offset + rewardTokenCount) as Token[];
    offset += rewardTokenCount;
    const erc4626AdapterTokens = rest.slice(offset) as Token[];

    return {
        vaultToken,
        underlyingToken,
        underlyingBreakdownTokens,
        rewardPoolTokens,
        boostRewardTokens,
        rewardTokens,
        erc4626AdapterTokens,
    };
};

export type ClassicTokens = Awaited<ReturnType<typeof loadClassicTokens>>;

const loadClmManagerContext = async ({
    context,
    chainId,
    managerAddress,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    managerAddress: Bytes;
}) => {
    const clmManager = await context.ClmManager.get(`${chainId}-${toHex(managerAddress)}`);
    if (!clmManager) {
        return null;
    }

    const [token0, token1] = await Promise.all([
        getTokenOrThrow({ context, id: clmManager.underlyingToken0_id }),
        getTokenOrThrow({ context, id: clmManager.underlyingToken1_id }),
    ]);

    return {
        clmManagerAddress: clmManager.address,
        clmUnderlyingToken0Address: token0.address,
        clmUnderlyingToken1Address: token1.address,
        clmUnderlyingToken0Decimals: token0.decimals,
        clmUnderlyingToken1Decimals: token1.decimals,
    };
};

export const buildClassicFetchInput = async ({
    context,
    chainId,
    classic,
    tokens,
    blockNumber,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    classic: Classic;
    tokens: ClassicTokens;
    blockNumber: number;
}) => {
    if (!classic.classicVaultStrategy_id) {
        throw new Error(`Classic ${classic.id} has no linked strategy`);
    }

    const strategyAddress = toBytes(classic.classicVaultStrategy_id.slice(`${String(chainId)}-`.length));

    let clmContext =
        (await loadClmManagerContext({
            context,
            chainId,
            managerAddress: tokens.underlyingToken.address,
        })) ?? null;

    if (!clmContext) {
        for (const rewardPoolToken of tokens.rewardPoolTokens) {
            clmContext = await loadClmManagerContext({
                context,
                chainId,
                managerAddress: rewardPoolToken.address,
            });
            if (clmContext) {
                break;
            }
        }
    }

    return {
        chainId,
        blockNumber,
        vaultAddress: toHex(classic.address),
        strategyAddress: toHex(strategyAddress),
        underlyingTokenAddress: toHex(tokens.underlyingToken.address),
        underlyingPlatform: classic.underlyingPlatform,
        underlyingTokenDecimals: tokens.underlyingToken.decimals,
        underlyingBreakdownTokens: tokens.underlyingBreakdownTokens.map((token) => ({
            address: toHex(token.address),
            decimals: token.decimals,
        })),
        rewardPoolTokenAddresses: classic.rewardPoolTokensOrder.map(asHex),
        erc4626AdapterTokenAddresses: classic.erc4626AdapterTokensOrder.map(asHex),
        boostRewardTokens: tokens.boostRewardTokens.map((token) => ({
            address: toHex(token.address),
            decimals: token.decimals,
        })),
        rewardTokens: tokens.rewardTokens.map((token) => ({
            address: toHex(token.address),
            decimals: token.decimals,
        })),
        clmManagerAddress: toHex(clmContext?.clmManagerAddress ?? ZERO_ADDRESS),
        clmUnderlyingToken0Address: toHex(clmContext?.clmUnderlyingToken0Address ?? ZERO_ADDRESS),
        clmUnderlyingToken1Address: toHex(clmContext?.clmUnderlyingToken1Address ?? ZERO_ADDRESS),
        clmUnderlyingToken0Decimals: clmContext?.clmUnderlyingToken0Decimals ?? 0,
        clmUnderlyingToken1Decimals: clmContext?.clmUnderlyingToken1Decimals ?? 0,
    };
};
