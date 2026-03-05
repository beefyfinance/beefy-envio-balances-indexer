import { S } from 'envio';
import { indexer } from 'generated';
import type { ChainId } from 'generated/src/Types';
import * as R from 'remeda';

export type { ChainId };
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
