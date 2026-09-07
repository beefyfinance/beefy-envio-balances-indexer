import * as R from 'remeda';
import { type Bytes, type Hex, toBytes, toHex } from '../../lib/hex';
/** Legacy vaults whose on-chain `want`/`token` reads return wrong hardcoded values. */
export const staticVaults = [
    // very old vault https://bscscan.com/address/0x83dfD1C2F553E8026eA8626399fe26Ce419dFDaC
    // where `want` field was hardcoded to `wbnb`
    {
        chainId: 56,
        vaultAddress: '0x6BE4741AB0aD233e4315a10bc783a7B923386b71',
        underlyingTokenAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        strategyAddress: '0x83dfD1C2F553E8026eA8626399fe26Ce419dFDaC',
    },

    // very old vault https://polygonscan.com/address/0x1d23ecC0645B07791b7D99349e253ECEbe43f614#readContract
    // where `want` field was hardcoded to `wmatic`
    {
        chainId: 137,
        vaultAddress: '0x1d23ecC0645B07791b7D99349e253ECEbe43f614',
        underlyingTokenAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
        strategyAddress: '0x57FdEB65b71e6aD212088E63E85825e314F2Ea62',
    },

    // BeefyVaultV6Native how no `want` field
    // https://snowtrace.io/address/0x99EeB92A4896a9F45E9390e2A05ceE5647BA0f95/contract/43114/code?chainid=43114
    {
        chainId: 43114,
        vaultAddress: '0x99EeB92A4896a9F45E9390e2A05ceE5647BA0f95',
        underlyingTokenAddress: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
        strategyAddress: '0x7D5bDbA328c659f5D28C6451be790DC67f5a7CA3',
    },
    {
        chainId: 43114,
        vaultAddress: '0xfda2E1E9BE74F60738e935b06A5d9C32143B18D5',
        underlyingTokenAddress: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
        strategyAddress: '0xe1526210f125c30227dfc398073896eC0a6eA9B9',
    },
    {
        chainId: 10,
        vaultAddress: '0x7ee71053102d54fc843baebaf07277c2b6db64f1',
        underlyingTokenAddress: '0x4200000000000000000000000000000000000006', // WETH
        strategyAddress: '0x27Efc41fAb7F0c1ebadd126E66a3A998FA35C99B',
    },
    {
        chainId: 43114,
        vaultAddress: '0x1b156c5c75e9df4caab2a5cc5999ac58ff4f9090',
        underlyingTokenAddress: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
        strategyAddress: '0xB06D0423e890905dFBA194fa167849a7B2e1B56B',
    },

    // ??? no idea, the block explorer is not working
    {
        chainId: 250,
        vaultAddress: '0x3D6AA308a59311D57456c2E968AdC1Dd3628869a',
        underlyingTokenAddress: '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83', // WFTM
        strategyAddress: '0xe7B675CC0B240857fCD8b8Fcc7B17cBF31444eF5',
    },
    {
        chainId: 250,
        vaultAddress: '0xbf1340159c1b69Ae98Ff08BE5fC77cdc084dDc73',
        underlyingTokenAddress: '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83', // WFTM
        strategyAddress: '0x212a9507CE6D0aC42990Bf42Db14d922a2A6bEed',
    },
    {
        chainId: 250,
        vaultAddress: '0x49c68edb7aebd968f197121453e41b8704acde0c',
        underlyingTokenAddress: '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83', // WFTM
        strategyAddress: '0x6d8CA0589702F30cED94C0D5c5d33b9e40D05C31',
    },
] as const;

const normalizedStaticVaults = R.pipe(
    staticVaults,
    R.map(({ chainId, vaultAddress, underlyingTokenAddress, strategyAddress }) => ({
        chainId,
        vaultAddress: toBytes(vaultAddress),
        underlyingTokenAddress: toBytes(underlyingTokenAddress),
        strategyAddress: toBytes(strategyAddress),
    }))
);

type StaticVault = (typeof normalizedStaticVaults)[number];

export const staticVaultsMap: Partial<Record<number, Record<Hex, StaticVault>>> = R.pipe(
    normalizedStaticVaults,
    R.groupBy(R.prop('chainId')),
    R.mapValues((vaults) => R.indexBy(vaults, (vault) => toHex(vault.vaultAddress)))
);

export const staticStrategyVaultMap: Partial<Record<number, Record<Hex, Bytes>>> = R.pipe(
    normalizedStaticVaults,
    R.groupBy(R.prop('chainId')),
    R.mapValues((vaults) =>
        R.pipe(
            vaults,
            R.indexBy((vault) => toHex(vault.strategyAddress)),
            R.mapValues((vault) => vault.vaultAddress)
        )
    )
);
