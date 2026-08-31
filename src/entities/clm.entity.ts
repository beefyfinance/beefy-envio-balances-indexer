import type { Clm, ClmManager, ClmStrategy, EvmBlock, EvmChainId, EvmOnEventContext, Token } from 'envio';
import type { Hex } from 'viem';
import type { ClmState } from '../effects/clm.effects';
import { BIG_ZERO, type BigDecimal } from '../lib/decimal';
import { normalizeHex } from '../lib/hex';

export const clmId = ({ chainId, managerAddress }: { chainId: EvmChainId; managerAddress: Hex }) =>
    `${chainId}-${normalizeHex(managerAddress)}`;

export const isClmInitialized = (clm: Clm): boolean => clm.initializableStatus === 'INITIALIZED';

export const getClm = async (context: EvmOnEventContext, chainId: EvmChainId, managerAddress: Hex) => {
    const id = clmId({ chainId, managerAddress });
    return await context.Clm.get(id);
};

export const getClmOrThrow = async (context: EvmOnEventContext, id: string): Promise<Clm> => {
    const clm = await context.Clm.get(id);
    if (!clm) {
        throw new Error(`Clm ${id} not found`);
    }
    return clm;
};

const emptyClmStats = () => ({
    managerTotalSupply: BIG_ZERO,
    rewardPoolsTotalSupply: [] as BigDecimal[],
    token0ToNativePrice: BIG_ZERO,
    token1ToNativePrice: BIG_ZERO,
    outputToNativePrices: [] as BigDecimal[],
    rewardToNativePrices: [] as BigDecimal[],
    nativeToUSDPrice: BIG_ZERO,
    priceOfToken0InToken1: BIG_ZERO,
    priceRangeMin1: BIG_ZERO,
    priceRangeMax1: BIG_ZERO,
    totalUnderlyingAmount0: BIG_ZERO,
    totalUnderlyingAmount1: BIG_ZERO,
    underlyingMainAmount0: BIG_ZERO,
    underlyingMainAmount1: BIG_ZERO,
    underlyingAltAmount0: BIG_ZERO,
    underlyingAltAmount1: BIG_ZERO,
    totalCallFees: BIG_ZERO,
    totalBeefyFees: BIG_ZERO,
    totalStrategistFees: BIG_ZERO,
});

export const getOrCreateClm = async ({
    context,
    chainId,
    managerAddress,
    clmManager,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    managerAddress: Hex;
    clmManager: ClmManager;
    initializedBlock: EvmBlock;
}): Promise<Clm> => {
    const id = clmId({ chainId, managerAddress });
    const existing = await context.Clm.get(id);
    if (existing) {
        return existing;
    }

    const clm: Clm = {
        id,
        address: managerAddress,
        clmManager_id: clmManager.id,
        clmStrategy_id: undefined,
        initializableStatus: 'INITIALIZING',
        pausableStatus: 'RUNNING',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
        managerToken_id: clmManager.shareToken_id,
        underlyingToken0_id: clmManager.underlyingToken0_id,
        underlyingToken1_id: clmManager.underlyingToken1_id,
        underlyingProtocolPool: normalizeHex('0x0000000000000000000000000000000000000000'),
        rewardPoolToken_ids: [],
        rewardPoolTokensOrder: [],
        outputToken_ids: [],
        outputTokensOrder: [],
        rewardToken_ids: [],
        rewardTokensOrder: [],
        ...emptyClmStats(),
    };

    context.Clm.set(clm);
    return clm;
};

export const linkClmStrategy = async ({
    context,
    clm,
    strategy,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    strategy: ClmStrategy;
}) => {
    context.Clm.set({
        ...clm,
        clmStrategy_id: strategy.id,
    });
};

export const finalizeClmInitialization = async ({
    context,
    clm,
    underlyingProtocolPool,
    outputToken,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    underlyingProtocolPool: Hex;
    outputToken: Token | null;
}) => {
    const outputToken_ids = [...clm.outputToken_ids];
    const outputTokensOrder = [...clm.outputTokensOrder];

    if (outputToken) {
        const outputAddress = normalizeHex(outputToken.address);
        if (!outputTokensOrder.includes(outputAddress)) {
            outputToken_ids.push(outputToken.id);
            outputTokensOrder.push(outputAddress);
        }
    }

    context.Clm.set({
        ...clm,
        underlyingProtocolPool,
        outputToken_ids,
        outputTokensOrder,
        initializableStatus: 'INITIALIZED',
        pausableStatus: 'RUNNING',
    });
};

export const linkClmRewardPool = async ({
    context,
    clm,
    rewardPoolShareToken,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    rewardPoolShareToken: Token;
}) => {
    const rewardPoolToken_ids = [...clm.rewardPoolToken_ids];
    const rewardPoolTokensOrder = [...clm.rewardPoolTokensOrder];
    const rewardPoolsTotalSupply = [...clm.rewardPoolsTotalSupply];
    const rewardPoolAddress = normalizeHex(rewardPoolShareToken.address);

    if (!rewardPoolTokensOrder.includes(rewardPoolAddress)) {
        rewardPoolToken_ids.push(rewardPoolShareToken.id);
        rewardPoolTokensOrder.push(rewardPoolAddress);
        rewardPoolsTotalSupply.push(BIG_ZERO);
    }

    context.Clm.set({
        ...clm,
        rewardPoolToken_ids,
        rewardPoolTokensOrder,
        rewardPoolsTotalSupply,
    });
};

export const addClmRewardToken = async ({
    context,
    clm,
    rewardToken,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    rewardToken: Token;
}) => {
    const rewardToken_ids = [...clm.rewardToken_ids];
    const rewardTokensOrder = [...clm.rewardTokensOrder];
    const rewardAddress = normalizeHex(rewardToken.address);

    if (rewardTokensOrder.includes(rewardAddress)) {
        return;
    }

    rewardToken_ids.push(rewardToken.id);
    rewardTokensOrder.push(rewardAddress);

    context.Clm.set({
        ...clm,
        rewardToken_ids,
        rewardTokensOrder,
    });
};

export const setClmPausableStatus = async ({
    context,
    clm,
    pausableStatus,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    pausableStatus: Clm['pausableStatus'];
}) => {
    context.Clm.set({
        ...clm,
        pausableStatus,
    });
};

export const clmStatsFromState = (state: ClmState) => ({
    managerTotalSupply: state.managerTotalSupply,
    rewardPoolsTotalSupply: state.rewardPoolsTotalSupply,
    token0ToNativePrice: state.token0ToNativePrice,
    token1ToNativePrice: state.token1ToNativePrice,
    outputToNativePrices: state.outputToNativePrices,
    rewardToNativePrices: state.rewardToNativePrices,
    nativeToUSDPrice: state.nativeToUSDPrice,
    priceOfToken0InToken1: state.priceOfToken0InToken1,
    priceRangeMin1: state.priceRangeMin1,
    priceRangeMax1: state.priceRangeMax1,
    totalUnderlyingAmount0: state.totalUnderlyingAmount0,
    totalUnderlyingAmount1: state.totalUnderlyingAmount1,
    underlyingMainAmount0: state.underlyingMainAmount0,
    underlyingMainAmount1: state.underlyingMainAmount1,
    underlyingAltAmount0: state.underlyingAltAmount0,
    underlyingAltAmount1: state.underlyingAltAmount1,
});

export const updateClmStats = async ({
    context,
    clm,
    state,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    state: ClmState;
}) => {
    context.Clm.set({
        ...clm,
        ...clmStatsFromState(state),
    });
};

export const incrementClmFees = async ({
    context,
    clm,
    callFees,
    beefyFees,
    strategistFees,
}: {
    context: EvmOnEventContext;
    clm: Clm;
    callFees: BigDecimal;
    beefyFees: BigDecimal;
    strategistFees: BigDecimal;
}) => {
    context.Clm.set({
        ...clm,
        totalCallFees: clm.totalCallFees.plus(callFees),
        totalBeefyFees: clm.totalBeefyFees.plus(beefyFees),
        totalStrategistFees: clm.totalStrategistFees.plus(strategistFees),
    });
};
