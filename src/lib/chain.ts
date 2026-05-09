import type { EvmChainId } from 'envio';
import { indexer, S } from 'envio';
import * as R from 'remeda';

export const chainIdSchema: S.Schema<EvmChainId, number> = S.union(
    R.pipe(
        indexer.chainIds,
        R.map((chainId) => S.schema(chainId))
    ) as [S.Schema<EvmChainId, number>, ...Array<S.Schema<EvmChainId, number>>]
);

export const toChainId = (chainId: number): EvmChainId => {
    return S.parseOrThrow(chainId, chainIdSchema);
};
