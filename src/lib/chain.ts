import { S } from 'envio';
import type { chainId } from 'generated';
import * as R from 'remeda';

export const allChainIds = [
    42161, // arbitrum
    // 1313161554, // aurora
    43114, // avax
    8453, // base
    80094, // berachain
    56, // bsc
    // 7700, // canto
    // 42220, // celo
    25, // cronos
    // 42262, // emerald
    1, // ethereum
    250, // fantom
    252, // fraxtal
    // 122, // fuse
    100, // gnosis
    // 1666600000, // harmony
    // 128, // heco
    999, // hyperevm
    2222, // kava
    59144, // linea
    1135, // lisk
    // 169, // manta
    5000, // mantle
    1088, // metis
    // 34443, // mode
    143, // monad
    1284, // moonbeam
    1285, // moonriver
    10, // optimism
    9745, // plasma
    137, // polygon
    // 111188, // real
    30, // rootstock
    // 5464, // saga
    534352, // scroll
    1329, // sei
    146, // sonic
    130, // unichain
    1101, // zkevm
    324, // zksync
] as const satisfies chainId[];

export const chainIdSchema = S.union(
    R.pipe(
        allChainIds,
        R.map((chainId) => S.schema(chainId))
    )
);

export type ChainId = S.Infer<typeof chainIdSchema>;

export const toChainId = (chainId: number): ChainId => {
    return S.parseOrThrow(chainId, chainIdSchema);
};
