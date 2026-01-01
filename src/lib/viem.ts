import type { Logger } from 'envio';
import { createPublicClient, defineChain, http, type Chain as ViemChain } from 'viem';
import {
    arbitrum,
    avalanche,
    base,
    berachain,
    bsc,
    cronos,
    fantom,
    fraxtal,
    gnosis,
    kava,
    linea,
    lisk,
    mainnet,
    mantle,
    metis,
    monad,
    optimism,
    plasma,
    polygon,
    polygonZkEvm,
    rootstock,
    scroll,
    sei,
    sonic,
    unichain,
    zksync,
} from 'viem/chains';
import type { ChainId } from './chain';
import { config } from './config';

const _emerald = defineChain({
    id: 42262,
    name: 'Emerald',
    nativeCurrency: {
        decimals: 18,
        name: 'Rose',
        symbol: 'ROSE',
    },
    rpcUrls: {
        default: {
            http: ['https://emerald.oasis.io'],
            webSocket: ['wss://emerald.oasis.io/ws'],
        },
    },
    blockExplorers: {
        default: { name: 'Explorer', url: 'https://explorer.oasis.io/mainnet/emerald' },
    },
    contracts: {
        multicall3: {
            address: '0xcA11bde05977b3631167028862bE2a173976CA11',
            blockCreated: 1481392,
        },
    },
});

const _heco = defineChain({
    id: 128,
    name: 'Heco',
    nativeCurrency: {
        decimals: 18,
        name: 'Huobi Token',
        symbol: 'HT',
    },
    rpcUrls: {
        default: {
            http: ['https://heco.drpc.org'],
        },
    },
    blockExplorers: {
        default: { name: 'Explorer', url: 'https://hecoscan.io/' },
    },
});

const hyperevm = defineChain({
    id: 999,
    name: 'HyperEVM',
    nativeCurrency: {
        decimals: 18,
        name: 'Hyperliquid',
        symbol: 'HYPE',
    },
    rpcUrls: {
        default: {
            http: ['https://rpc.hyperliquid.xyz/evm'],
            webSocket: ['wss://rpc.hyperliquid.xyz/evm'],
        },
    },
    blockExplorers: {
        default: { name: 'Explorer', url: '"https://www.hyperscan.com' },
    },
    contracts: {
        multicall3: {
            address: '0xcA11bde05977b3631167028862bE2a173976CA11',
            blockCreated: 13051,
        },
    },
});

const chainMap: Record<ChainId, ViemChain> = {
    // 1313161554: aurora,
    42161: arbitrum,
    43114: avalanche,
    8453: base,
    80094: berachain,
    56: bsc,
    // 7700: canto,
    // 42220: celo,
    25: cronos,
    // 42262: emerald,
    1: mainnet,
    250: fantom,
    252: fraxtal,
    100: gnosis,
    // 128: heco,
    // 122: fuse,
    2222: kava,
    999: hyperevm,
    59144: linea,
    1135: lisk,
    // 169: manta,
    5000: mantle,
    1088: metis,
    // 34443: mode,
    143: monad,
    // 1284: moonbeam,
    // 1285: moonriver,
    // 1666600000: harmonyOne,
    10: optimism,
    9745: plasma,
    137: polygon,
    // 111188: real,
    30: rootstock,
    // 5464: saga,
    534352: scroll,
    1329: sei,
    146: sonic,
    130: unichain,
    1101: polygonZkEvm,
    324: zksync,
};

export const getViemClient = (chainId: ChainId, logger: Logger) => {
    const rpcUrl = config.RPC_URL[chainId];

    return createPublicClient({
        chain: chainMap[chainId],
        // Enable multicall batching for efficiency
        // batch: {
        //     multicall: {
        //         batchSize: 512, /* bytes */
        //         deployless: false,
        //         wait: 200, /* ms */
        //     }
        // },
        // disable multicall batching to allow downstream erpc to cache calls more granularly
        batch: {
            multicall: false,
        },
        // Thanks to automatic Effect API batching, we can also enable batching for Viem transport level
        transport: http(rpcUrl, {
            onFetchRequest: async (request) => {
                const requestData = await request.clone().json();
                logger.debug('rpc.http: request', { request: requestData });
            },
            onFetchResponse: async (response) => {
                const responseData = await response.clone().json();
                logger.debug('rpc.http: response', { response: responseData });
            },

            // erpc batches requests for us, no need to do it on the client level
            // batch: {
            //     batchSize: 20 /* requests */,
            //     wait: 200 /* ms */,
            // },
            batch: false,

            // more aggressive retry count
            // but allow more time for backup
            // max time is Array.from({length:5}).map((_,i) => ~~(1 << i) * 500).reduce((a,i) => a+i,0)
            // => 15500ms
            retryCount: 5,
            retryDelay: 500,

            // it's ok to have a longer timeout here because we're using erpc
            // and a lot of the retry logic and fallback and stuff is handled there
            // so we are ok waiting longer but make sure we have an answer
            timeout: 30_000,
        }),
    });
};
