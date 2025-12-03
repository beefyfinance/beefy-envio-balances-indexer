import { S } from 'envio';
import * as R from 'remeda';
import { allChainIds } from './chain';
import { hexSchema } from './hex';

const configSchema = S.schema({
    ADDRESS_ZERO: hexSchema,
    BURN_ADDRESS: hexSchema,
    MINT_ADDRESS: hexSchema,
    RPC_URL: S.schema(
        R.pipe(
            allChainIds,
            R.map((chainId) => [chainId, S.string] as const),
            R.fromEntries()
        )
    ),
});

export const config = S.parseOrThrow(
    {
        ADDRESS_ZERO: '0x0000000000000000000000000000000000000000',
        BURN_ADDRESS: '0x000000000000000000000000000000000000dead',
        MINT_ADDRESS: '0x0000000000000000000000000000000000000000',
        RPC_URL: R.pipe(
            allChainIds,
            R.map((chainId) => [chainId, process.env[`ENVIO_RPC_URL_${chainId}`] ?? null] as const),
            R.fromEntries()
        ),
    },
    configSchema
);
