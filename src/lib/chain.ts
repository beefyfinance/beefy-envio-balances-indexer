import { S } from 'envio';
import { type ChainId as ChainIdType, indexer } from 'generated';
import * as R from 'remeda';

export type ChainId = ChainIdType;
export const allChainIds = indexer.chainIds;
export const chainIdSchema: S.Schema<ChainId, number> = S.union(
    R.pipe(
        allChainIds,
        R.map((chainId) => S.schema(chainId))
    ) as [S.Schema<ChainId, number>, ...Array<S.Schema<ChainId, number>>]
);

export const toChainId = (chainId: number): ChainId => {
    return S.parseOrThrow(chainId, chainIdSchema);
};
