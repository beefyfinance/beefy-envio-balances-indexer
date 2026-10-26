import type { EvmChainId } from 'envio';
import { indexer } from 'envio';
import * as R from 'remeda';

/** RPC endpoint per chain, used by the cached effects (`ENVIO_RPC_URL_<chainId>`). */
export const RPC_URL = R.pipe(
    indexer.chainIds,
    R.map((chainId) => [chainId, process.env[`ENVIO_RPC_URL_${chainId}`]] as const),
    R.fromEntries()
) as Record<EvmChainId, string | undefined>;
