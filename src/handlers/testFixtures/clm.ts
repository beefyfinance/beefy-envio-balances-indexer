import type { EvmBlock } from 'envio';
import type { Hex } from '../../lib/hex';
import { FACTORIES, registerClmManager, registerClmStrategy } from './register';

/** Base chain id */
export const CHAIN_BASE = 8453 as const;

/** Cow Sushi Base WETH-USDC — https://api.beefy.finance/cow-vaults */
export const MANAGER_BASE = '0x603492ff8943f5ac69aa69cf09fc96fda2606ee7' as const;
export const STRATEGY_BASE = '0x51582dcef28aea484dd87933324a55482882ce17' as const;

/** Block/timestamp when manager + strategy were both initialized in tests */
export const BASE_CLM_INIT_BLOCK = 15_683_455;
export const BASE_CLM_INIT_TIMESTAMP = Math.floor(Date.parse('2024-07-15T12:00:00.000Z') / 1000);

export const eventMeta = ({
    trxHash,
    trxIndex,
    logIndex,
    block,
}: {
    trxHash: Hex;
    trxIndex: number;
    logIndex: number;
    block: EvmBlock;
}) => ({
    block,
    transaction: { hash: trxHash, transactionIndex: trxIndex },
    logIndex,
});

export const initBaseClmSim = ({
    blockNum = BASE_CLM_INIT_BLOCK,
    timestampSec = BASE_CLM_INIT_TIMESTAMP,
}: {
    blockNum?: number;
    timestampSec?: number;
} = {}) => {
    const block = { number: blockNum, timestamp: timestampSec };
    // Register dynamic contracts before Initialized — required since Envio 3.3.
    return [
        registerClmManager({
            factory: FACTORIES[8453].ClmManagerFactory,
            proxy: MANAGER_BASE,
            block,
            logIndex: 0,
        }),
        registerClmStrategy({
            factory: FACTORIES[8453].ClmStrategyFactory,
            proxy: STRATEGY_BASE,
            block,
            logIndex: 1,
        }),
        {
            contract: 'ClmManager' as const,
            event: 'Initialized' as const,
            block,
            logIndex: 2,
            srcAddress: MANAGER_BASE,
            params: { version: 1n },
        },
        {
            contract: 'ClmStrategy' as const,
            event: 'Initialized' as const,
            block,
            logIndex: 3,
            srcAddress: STRATEGY_BASE,
            params: { version: 1n },
        },
    ];
};

/** First Deposit — https://basescan.org/tx/0x5a4fbda772ea9a1754da8fff90de60da9fb2acb06432ea0c9a7cd8719c05443d */
export const BASE_DEPOSIT = {
    blockNum: 17_452_460,
    timestampSec: 1721694267,
    trxHash: '0x5a4fbda772ea9a1754da8fff90de60da9fb2acb06432ea0c9a7cd8719c05443d' as Hex,
    trxIndex: 6,
    logIndex: 22,
    user: '0x6f19da51d488926c007b9ebaa5968291a2ec6a63' as Hex,
    shares: 10_341_879n,
    amount0: 1_500_000_000_000_000n,
    amount1: 5_171_663n,
    fee0: 0n,
    fee1: 0n,
};

/** First Harvest — https://basescan.org/tx/0x7e29db7de6b8d447c99f929ab6d2fdb8acf913f66d011e4885293bb0977663d2 */
export const BASE_HARVEST = {
    blockNum: 17_487_152,
    timestampSec: 1721763651,
    trxHash: '0x7e29db7de6b8d447c99f929ab6d2fdb8acf913f66d011e4885293bb0977663d2' as Hex,
    trxIndex: 51,
    logIndex: 4205,
    fee0: 52_503_818_585_178n,
    fee1: 273_190n,
};

/** ClaimedFees in same tx as first harvest, logIndex 4184 */
export const BASE_CLAIMED_FEES = {
    ...BASE_HARVEST,
    logIndex: 4184,
    feeMain0: 0x2084d1f74db2n,
    feeMain1: 0x33e19n,
    feeAlt0: 0n,
    feeAlt1: 0n,
};

/** TVL event in same harvest tx, logIndex 4201 */
export const BASE_TVL = {
    ...BASE_HARVEST,
    logIndex: 4201,
    bal0: 0x35f1f6932n,
    bal1: 0xbd70b4e6n,
};

/** Withdraw — https://basescan.org/tx/0x982f321d7cf4048fa7cff6a39990441d8b67126e4be9b7b55923c68f7defe39c */
export const BASE_WITHDRAW = {
    blockNum: 17_495_891,
    timestampSec: 1721781129,
    trxHash: '0x982f321d7cf4048fa7cff6a39990441d8b67126e4be9b7b55923c68f7defe39c' as Hex,
    trxIndex: 0,
    logIndex: 193,
    user: '0x6f19da51d488926c007b9ebaa5968291a2ec6a63' as Hex,
    shares: 966_938_656n,
    amount0: 137_096_824_193_939_866n,
    amount1: 493_823_618n,
};
