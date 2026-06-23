import type { Hex } from 'viem';

/** Polygon chain id */
export const CHAIN_POLYGON = 137 as const;

/**
 * Polygon stMATIC Aave vault — not in staticVaults; exercises live multicall + AAVE detection.
 * https://polygonscan.com/address/0x009e0abc8cecbc576dfe2b8e372338b8e597dbc9
 */
export const AAVE_FIXTURE = {
    chainId: CHAIN_POLYGON,
    vault: '0x009e0abc8cecbc576dfe2b8e372338b8e597dbc9' as const,
    strategy: '0xe47cf2cea1db2f7f7aa84dc00a2cda2a95b21fe1' as const,
    initBlock: 50_000_000,
    initTimestamp: 1_710_288_000, // polygon block 50_000_000 (overwritten if RPC fetch differs)
} as const;

/**
 * Polygon MAI+3Crv Curve vault — multi-token underlying breakdown.
 * https://polygonscan.com/address/0x122e09fdd2ff73c8cea51d432c45a474baa1518a
 */
export const CURVE_FIXTURE = {
    chainId: CHAIN_POLYGON,
    vault: '0x122e09fdd2ff73c8cea51d432c45a474baa1518a' as const,
    strategy: '0xd9c0e8672b498bb28efe95ceaa0d4e32e57cc206' as const,
    initBlock: 50_000_000,
    initTimestamp: 1_710_288_000,
} as const;

export type ClassicPlatformFixture = typeof AAVE_FIXTURE | typeof CURVE_FIXTURE;

export const initClassicPlatformSim = (fixture: ClassicPlatformFixture) => {
    const block = { number: fixture.initBlock, timestamp: fixture.initTimestamp };
    return [
        {
            contract: 'ClassicVault' as const,
            event: 'Initialized' as const,
            block,
            logIndex: 0,
            srcAddress: fixture.vault as Hex,
            params: { version: 1n },
        },
        {
            contract: 'ClassicStrategy' as const,
            event: 'Initialized' as const,
            block,
            logIndex: 1,
            srcAddress: fixture.strategy as Hex,
            params: { version: 1n },
        },
    ];
};
