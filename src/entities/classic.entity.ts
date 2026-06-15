import type {
    Classic,
    ClassicVault,
    ClassicVaultStrategy,
    EvmBlock,
    EvmChainId,
    EvmOnEventContext,
    Token,
} from 'envio';
import type { Hex } from 'viem';
import type { ClassicState } from '../effects/classic.effects';
import { BIG_ZERO, type BigDecimal } from '../lib/decimal';
import { normalizeHex } from '../lib/hex';

export const classicId = ({ chainId, vaultAddress }: { chainId: EvmChainId; vaultAddress: Hex }) =>
    `${chainId}-${normalizeHex(vaultAddress)}`;

export const isClassicInitialized = (classic: Classic): boolean => classic.initializableStatus === 'INITIALIZED';

export const getClassic = async (context: EvmOnEventContext, chainId: EvmChainId, vaultAddress: Hex | string) => {
    const id = classicId({ chainId, vaultAddress: normalizeHex(vaultAddress) as Hex });
    return await context.Classic.get(id);
};

export const getClassicOrThrow = async (context: EvmOnEventContext, id: string): Promise<Classic> => {
    const classic = await context.Classic.get(id);
    if (!classic) {
        throw new Error(`Classic ${id} not found`);
    }
    return classic;
};

const emptyClassicStats = () => ({
    vaultTokenTotalSupply: BIG_ZERO,
    underlyingAmount: BIG_ZERO,
    vaultUnderlyingTotalSupply: BIG_ZERO,
    vaultUnderlyingBreakdownBalances: [] as BigDecimal[],
    vaultUnderlyingBalance: BIG_ZERO,
    rewardPoolsTotalSupply: [] as BigDecimal[],
    erc4626AdaptersTotalSupply: [] as BigDecimal[],
    erc4626AdapterVaultSharesBalances: [] as BigDecimal[],
    underlyingToNativePrice: BIG_ZERO,
    underlyingBreakdownToNativePrices: [] as BigDecimal[],
    boostRewardToNativePrices: [] as BigDecimal[],
    rewardToNativePrices: [] as BigDecimal[],
    nativeToUSDPrice: BIG_ZERO,
    totalCallFees: BIG_ZERO,
    totalBeefyFees: BIG_ZERO,
    totalStrategistFees: BIG_ZERO,
});

export const getOrCreateClassic = async ({
    context,
    chainId,
    vaultAddress,
    classicVault,
    initializedBlock,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    vaultAddress: Hex;
    classicVault: ClassicVault;
    initializedBlock: EvmBlock;
}): Promise<Classic> => {
    const id = classicId({ chainId, vaultAddress });
    const existing = await context.Classic.get(id);
    if (existing) {
        return existing;
    }

    const classic: Classic = {
        id,
        chainId,
        address: vaultAddress,
        classicVault_id: classicVault.id,
        classicVaultStrategy_id: undefined,
        initializableStatus: 'INITIALIZING',
        pausableStatus: 'RUNNING',
        initializedBlock: BigInt(initializedBlock.number),
        initializedTimestamp: new Date(initializedBlock.timestamp * 1000),
        vaultToken_id: classicVault.shareToken_id,
        underlyingToken_id: classicVault.underlyingToken_id,
        underlyingPlatform: 'UNKNOWN',
        underlyingBreakdownToken_ids: [],
        underlyingBreakdownTokensOrder: [],
        rewardPoolToken_ids: [],
        rewardPoolTokensOrder: [],
        boostRewardToken_ids: [],
        boostRewardTokensOrder: [],
        rewardToken_ids: [],
        rewardTokensOrder: [],
        erc4626AdapterToken_ids: [],
        erc4626AdapterTokensOrder: [],
        ...emptyClassicStats(),
    };

    context.Classic.set(classic);
    return classic;
};

export const linkClassicVaultStrategy = async ({
    context,
    classic,
    strategy,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    strategy: ClassicVaultStrategy;
}) => {
    context.Classic.set({
        ...classic,
        classicVaultStrategy_id: strategy.id,
    });
};

export const finalizeClassicInitialization = async ({
    context,
    classic,
    underlyingPlatform,
    underlyingBreakdownTokens,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    underlyingPlatform: string;
    underlyingBreakdownTokens: Token[];
}) => {
    const underlyingBreakdownToken_ids = underlyingBreakdownTokens.map((token) => token.id);
    const underlyingBreakdownTokensOrder = underlyingBreakdownTokens.map((token) => normalizeHex(token.address));

    context.Classic.set({
        ...classic,
        underlyingPlatform,
        underlyingBreakdownToken_ids,
        underlyingBreakdownTokensOrder,
        initializableStatus: 'INITIALIZED',
        pausableStatus: 'RUNNING',
    });
};

export const linkClassicRewardPool = async ({
    context,
    classic,
    rewardPoolShareToken,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    rewardPoolShareToken: Token;
}) => {
    const rewardPoolToken_ids = [...classic.rewardPoolToken_ids];
    const rewardPoolTokensOrder = [...classic.rewardPoolTokensOrder];
    const rewardPoolsTotalSupply = [...classic.rewardPoolsTotalSupply];
    const rewardPoolAddress = normalizeHex(rewardPoolShareToken.address);

    if (!rewardPoolTokensOrder.includes(rewardPoolAddress)) {
        rewardPoolToken_ids.push(rewardPoolShareToken.id);
        rewardPoolTokensOrder.push(rewardPoolAddress);
        rewardPoolsTotalSupply.push(BIG_ZERO);
    }

    context.Classic.set({
        ...classic,
        rewardPoolToken_ids,
        rewardPoolTokensOrder,
        rewardPoolsTotalSupply,
    });
};

export const addClassicBoostRewardToken = async ({
    context,
    classic,
    rewardToken,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    rewardToken: Token;
}) => {
    const boostRewardToken_ids = [...classic.boostRewardToken_ids];
    const boostRewardTokensOrder = [...classic.boostRewardTokensOrder];
    const rewardAddress = normalizeHex(rewardToken.address);

    if (boostRewardTokensOrder.includes(rewardAddress)) {
        return;
    }

    boostRewardToken_ids.push(rewardToken.id);
    boostRewardTokensOrder.push(rewardAddress);

    context.Classic.set({
        ...classic,
        boostRewardToken_ids,
        boostRewardTokensOrder,
    });
};

export const addClassicRewardToken = async ({
    context,
    classic,
    rewardToken,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    rewardToken: Token;
}) => {
    const rewardToken_ids = [...classic.rewardToken_ids];
    const rewardTokensOrder = [...classic.rewardTokensOrder];
    const rewardAddress = normalizeHex(rewardToken.address);

    if (rewardTokensOrder.includes(rewardAddress)) {
        return;
    }

    rewardToken_ids.push(rewardToken.id);
    rewardTokensOrder.push(rewardAddress);

    context.Classic.set({
        ...classic,
        rewardToken_ids,
        rewardTokensOrder,
    });
};

export const linkClassicErc4626Adapter = async ({
    context,
    classic,
    adapterShareToken,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    adapterShareToken: Token;
}) => {
    const erc4626AdapterToken_ids = [...classic.erc4626AdapterToken_ids];
    const erc4626AdapterTokensOrder = [...classic.erc4626AdapterTokensOrder];
    const erc4626AdaptersTotalSupply = [...classic.erc4626AdaptersTotalSupply];
    const erc4626AdapterVaultSharesBalances = [...classic.erc4626AdapterVaultSharesBalances];
    const adapterAddress = normalizeHex(adapterShareToken.address);

    if (!erc4626AdapterTokensOrder.includes(adapterAddress)) {
        erc4626AdapterToken_ids.push(adapterShareToken.id);
        erc4626AdapterTokensOrder.push(adapterAddress);
        erc4626AdaptersTotalSupply.push(BIG_ZERO);
        erc4626AdapterVaultSharesBalances.push(BIG_ZERO);
    }

    context.Classic.set({
        ...classic,
        erc4626AdapterToken_ids,
        erc4626AdapterTokensOrder,
        erc4626AdaptersTotalSupply,
        erc4626AdapterVaultSharesBalances,
    });
};

export const setClassicPausableStatus = async ({
    context,
    classic,
    pausableStatus,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    pausableStatus: Classic['pausableStatus'];
}) => {
    context.Classic.set({
        ...classic,
        pausableStatus,
    });
};

export const classicStatsFromState = (state: ClassicState) => ({
    vaultTokenTotalSupply: state.vaultTokenTotalSupply,
    underlyingAmount: state.underlyingAmount,
    vaultUnderlyingTotalSupply: state.vaultUnderlyingTotalSupply,
    vaultUnderlyingBreakdownBalances: state.vaultUnderlyingBreakdownBalances,
    vaultUnderlyingBalance: state.underlyingAmount,
    rewardPoolsTotalSupply: state.rewardPoolsTotalSupply,
    erc4626AdaptersTotalSupply: state.erc4626AdaptersTotalSupply,
    erc4626AdapterVaultSharesBalances: state.erc4626AdapterVaultSharesBalances,
    underlyingToNativePrice: state.underlyingToNativePrice,
    underlyingBreakdownToNativePrices: state.underlyingBreakdownToNativePrices,
    boostRewardToNativePrices: state.boostRewardToNativePrices,
    rewardToNativePrices: state.rewardToNativePrices,
    nativeToUSDPrice: state.nativeToUSDPrice,
});

export const updateClassicStats = async ({
    context,
    classic,
    state,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    state: ClassicState;
}) => {
    context.Classic.set({
        ...classic,
        ...classicStatsFromState(state),
    });
};

export const incrementClassicFees = async ({
    context,
    classic,
    callFees,
    beefyFees,
    strategistFees,
}: {
    context: EvmOnEventContext;
    classic: Classic;
    callFees: BigDecimal;
    beefyFees: BigDecimal;
    strategistFees: BigDecimal;
}) => {
    context.Classic.set({
        ...classic,
        totalCallFees: classic.totalCallFees.plus(callFees),
        totalBeefyFees: classic.totalBeefyFees.plus(beefyFees),
        totalStrategistFees: classic.totalStrategistFees.plus(strategistFees),
    });
};

export const isClassicVaultAddress = async (
    context: EvmOnEventContext,
    chainId: EvmChainId,
    vaultAddress: Hex | string
): Promise<boolean> => {
    const vault = await context.ClassicVault.get(
        classicId({ chainId, vaultAddress: normalizeHex(vaultAddress) as Hex })
    );
    return vault !== undefined;
};
