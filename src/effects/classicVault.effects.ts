import { createEffect } from 'envio';
import * as R from 'remeda';
import type { Hex } from 'viem';
import { blacklistStatus } from '../lib/blacklist';
import { chainIdSchema } from '../lib/chain';
import { ADDRESS_ZERO } from '../lib/decimal';
import { hexSchema } from '../lib/hex';
import { getViemClient } from '../lib/viem';

export const getClassicVaultTokens = createEffect(
    {
        name: 'getClassicVaultTokens',
        input: {
            vaultAddress: hexSchema,
            chainId: chainIdSchema,
        },
        output: {
            shareTokenAddress: hexSchema,
            underlyingTokenAddress: hexSchema,
            strategyAddress: hexSchema,
            blacklistStatus: blacklistStatus,
        },
        rateLimit: false,
        cache: true,
    },
    async ({ input, context }) => {
        const { vaultAddress, chainId } = input;

        const staticVault = staticVaultsMap[chainId]?.[vaultAddress.toLowerCase() as `0x${string}`];
        if (staticVault) {
            return {
                shareTokenAddress: staticVault.underlyingTokenAddress,
                underlyingTokenAddress: staticVault.underlyingTokenAddress,
                strategyAddress: staticVault.strategyAddress,
                blacklistStatus: 'ok' as const,
            };
        }

        const client = getViemClient(chainId, context.log);

        context.log.debug('Fetching ClassicVault tokens', { vaultAddress, chainId });

        const [tokenResult, wantResult, strategyResult] = await client.multicall({
            allowFailure: true,
            contracts: [
                // token (BeefyVaultV4 and before)
                {
                    address: vaultAddress as `0x${string}`,
                    abi: [
                        {
                            inputs: [],
                            name: 'token',
                            outputs: [{ name: '', type: 'address' }],
                            stateMutability: 'view',
                            type: 'function',
                        },
                    ],
                    functionName: 'token',
                    args: [],
                },
                // token (BeefyVaultV5 and after)
                {
                    address: vaultAddress as `0x${string}`,
                    abi: [
                        {
                            inputs: [],
                            name: 'want',
                            outputs: [{ name: '', type: 'address' }],
                            stateMutability: 'view',
                            type: 'function',
                        },
                    ],
                    functionName: 'want',
                    args: [],
                },
                {
                    address: vaultAddress as `0x${string}`,
                    abi: [
                        {
                            inputs: [],
                            name: 'strategy',
                            outputs: [{ name: '', type: 'address' }],
                            stateMutability: 'view',
                            type: 'function',
                        },
                    ],
                    functionName: 'strategy',
                    args: [],
                },
            ],
        });

        // The vault contract itself is the share token
        const shareTokenAddress = vaultAddress;

        let underlyingTokenAddress: `0x${string}` | null = null;
        if (wantResult.status === 'success') {
            // vault v5 and after
            underlyingTokenAddress = wantResult.result;
        } else if (tokenResult.status === 'success') {
            // vault v4 and before
            underlyingTokenAddress = tokenResult.result;
        } else {
            context.log.error('ClassicVault want AND token call failed', { vaultAddress, chainId });
            return {
                shareTokenAddress,
                underlyingTokenAddress: ADDRESS_ZERO,
                strategyAddress: ADDRESS_ZERO,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        if (strategyResult.status === 'failure') {
            context.log.error('ClassicVault strategy call failed', { vaultAddress, chainId });
            throw new Error('ClassicVault strategy call failed');
        }

        const strategyAddress = strategyResult.result;

        context.log.info('ClassicVault data fetched', {
            vaultAddress,
            shareTokenAddress,
            underlyingTokenAddress,
            strategyAddress,
        });

        if (underlyingTokenAddress === ADDRESS_ZERO) {
            return {
                shareTokenAddress,
                underlyingTokenAddress,
                strategyAddress,
                blacklistStatus: 'blacklisted' as const,
            };
        }

        return {
            shareTokenAddress,
            underlyingTokenAddress,
            strategyAddress,
            blacklistStatus: 'ok' as const,
        };
    }
);

const staticVaults = [
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
];

const staticVaultsMap = R.pipe(
    staticVaults,
    R.map(({ chainId, vaultAddress, underlyingTokenAddress, strategyAddress }) => ({
        chainId,
        vaultAddress: vaultAddress.toLowerCase() as Hex,
        underlyingTokenAddress: underlyingTokenAddress.toLowerCase() as Hex,
        strategyAddress: strategyAddress.toLowerCase() as Hex,
    })),
    R.groupBy(R.prop('chainId')),
    R.mapValues(R.indexBy(R.prop('vaultAddress')))
);
