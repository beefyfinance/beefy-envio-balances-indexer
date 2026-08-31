import type { EvmBlock } from 'envio';
import type { Hex } from 'viem';
import { FACTORIES, registerClassicStrategy } from './register';

/** BSC chain id */
export const CHAIN_BSC = 56 as const;

/** BSC WBNB vault — see config/classic/staticVaults.ts */
export const VAULT_BSC = '0x6be4741ab0ad233e4315a10bc783a7b923386b71' as const;
export const STRATEGY_BSC = '0x83dfd1c2f553e8026ea8626399fe26ce419dfdac' as const;

export const BSC_CLASSIC_INIT_BLOCK = 12_132_390;
export const BSC_CLASSIC_INIT_TIMESTAMP = Math.floor(Date.parse('2021-10-27T09:56:05.000Z') / 1000);

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

/** Block + log metadata without transaction fields (for events that don't select them). */
export const eventBlockMeta = ({ logIndex, block }: { logIndex: number; block: EvmBlock }) => ({
    block,
    logIndex,
});

/** StratHarvest — https://bscscan.com/tx/0x0b6a1d3e7567800b2681f51c43210747844b8d0f42f74891d2ef42dad110f9d4 */
export const BSC_STRAT_HARVEST = {
    blockNum: 42_085_576,
    timestampSec: 1_725_833_432,
    trxHash: '0x0b6a1d3e7567800b2681f51c43210747844b8d0f42f74891d2ef42dad110f9d4' as Hex,
    trxIndex: 13,
    logIndex: 116,
    harvester: '0x03d9964f4d93a24b58c0fc3a8df3474b59ba8557' as Hex,
    wantHarvested: 1_197_622_431_852_977n,
    tvl: 3_483_472_962_794_350_264_868n,
};

/** ChargedFeesV2 in same tx as first harvest, logIndex 109 */
export const BSC_CHARGED_FEES_V2 = {
    ...BSC_STRAT_HARVEST,
    logIndex: 109,
    callFees: 6_616_698_518_524n,
    beefyFees: 112_483_874_814_919n,
    strategistFees: 6_616_698_518_524n,
};

export const initBscClassicSim = ({
    blockNum = BSC_CLASSIC_INIT_BLOCK,
    timestampSec = BSC_CLASSIC_INIT_TIMESTAMP,
}: {
    blockNum?: number;
    timestampSec?: number;
} = {}) => {
    const block = { number: blockNum, timestamp: timestampSec };
    return [
        {
            contract: 'ClassicVault' as const,
            event: 'Initialized' as const,
            block,
            logIndex: 0,
            srcAddress: VAULT_BSC,
            params: { version: 1n },
        },
        registerClassicStrategy({
            factory: FACTORIES[56].ClassicStrategyFactory,
            proxy: STRATEGY_BSC,
            block,
            logIndex: 1,
        }),
        {
            contract: 'ClassicStrategy' as const,
            event: 'Initialized' as const,
            block,
            logIndex: 2,
            srcAddress: STRATEGY_BSC,
            params: { version: 1n },
        },
    ];
};
