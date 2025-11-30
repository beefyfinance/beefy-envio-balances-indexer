import { S } from 'envio';
import type { ChainId } from './chain';
import { hexSchema } from './hex';

const configSchema = S.schema({
    ADDRESS_ZERO: hexSchema,
    BURN_ADDRESS: hexSchema,
    MINT_ADDRESS: hexSchema,
    RPC_URL: S.schema({
        1313161554: S.string, // aurora
        42161: S.string, // arbitrum
        43114: S.string, // avax
        8453: S.string, // base
        80094: S.string, // berachain
        56: S.string, // bsc
        7700: S.string, // canto
        42220: S.string, // celo
        25: S.string, // cronos
        42262: S.string, // emerald
        1: S.string, // ethereum
        250: S.string, // fantom
        252: S.string, // fraxtal
        100: S.string, // gnosis
        128: S.string, // heco
        122: S.string, // fuse
        999: S.string, // hyperevm
        2222: S.string, // kava
        59144: S.string, // linea
        1135: S.string, // lisk
        169: S.string, // manta
        5000: S.string, // mantle
        1088: S.string, // metis
        34443: S.string, // mode
        143: S.string, // monad
        1284: S.string, // moonbeam
        1285: S.string, // moonriver
        1666600000: S.string, // one
        10: S.string, // optimism
        9745: S.string, // plasma
        137: S.string, // polygon
        111188: S.string, // real
        30: S.string, // rootstock
        5464: S.string, // saga
        534352: S.string, // scroll
        1329: S.string, // sei
        146: S.string, // sonic
        130: S.string, // unichain
        1101: S.string, // zkevm
        324: S.string, // zksync
        // biome-ignore lint/suspicious/noExplicitAny: it's fine here
    } satisfies Record<ChainId, any>),
});

export const config = S.parseOrThrow(
    {
        ADDRESS_ZERO: '0x0000000000000000000000000000000000000000',
        BURN_ADDRESS: '0x000000000000000000000000000000000000dead',
        MINT_ADDRESS: '0x0000000000000000000000000000000000000000',
        RPC_URL: {
            1313161554: process.env.AURORA_RPC_URL ?? null,
            42161: process.env.ARBITRUM_RPC_URL ?? null,
            43114: process.env.AVAX_RPC_URL ?? null,
            8453: process.env.BASE_RPC_URL ?? null,
            80094: process.env.BERACHAIN_RPC_URL ?? null,
            56: process.env.BSC_RPC_URL ?? null,
            7700: process.env.CANTO_RPC_URL ?? null,
            42220: process.env.CELO_RPC_URL ?? null,
            25: process.env.CRONOS_RPC_URL ?? null,
            42262: process.env.EMERALD_RPC_URL ?? null,
            1: process.env.ETHEREUM_RPC_URL ?? null,
            250: process.env.FANTOM_RPC_URL ?? null,
            252: process.env.FRAXTAL_RPC_URL ?? null,
            100: process.env.GNOSIS_RPC_URL ?? null,
            128: process.env.HECO_RPC_URL ?? null,
            122: process.env.FUSE_RPC_URL ?? null,
            999: process.env.HYPEREVM_RPC_URL ?? null,
            2222: process.env.KAVA_RPC_URL ?? null,
            59144: process.env.LINEA_RPC_URL ?? null,
            1135: process.env.LISK_RPC_URL ?? null,
            169: process.env.MANTA_RPC_URL ?? null,
            5000: process.env.MANTLE_RPC_URL ?? null,
            1088: process.env.METIS_RPC_URL ?? null,
            34443: process.env.MODE_RPC_URL ?? null,
            143: process.env.MONAD_RPC_URL ?? null,
            1284: process.env.MOONBEAM_RPC_URL ?? null,
            1285: process.env.MOONRIVER_RPC_URL ?? null,
            1666600000: process.env.ONE_RPC_URL ?? null,
            10: process.env.OPTIMISM_RPC_URL ?? null,
            9745: process.env.PLASMA_RPC_URL ?? null,
            137: process.env.POLYGON_RPC_URL ?? null,
            111188: process.env.REAL_RPC_URL ?? null,
            30: process.env.ROOTSTOCK_RPC_URL ?? null,
            5464: process.env.SAGA_RPC_URL ?? null,
            534352: process.env.SCROLL_RPC_URL ?? null,
            1329: process.env.SEI_RPC_URL ?? null,
            146: process.env.SONIC_RPC_URL ?? null,
            130: process.env.UNICHAIN_RPC_URL ?? null,
            1101: process.env.ZKEVM_RPC_URL ?? null,
            324: process.env.ZKSYNC_RPC_URL ?? null,
        } satisfies Record<ChainId, string | null>,
    },
    configSchema
);
