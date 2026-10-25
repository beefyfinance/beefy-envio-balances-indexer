/** Dynamic-registration helpers shared by `contractRegister` handlers (pure: no RPC, no entities). */
import { type EvmChainId, type EvmContractRegisterContext, indexer } from 'envio';
import { decodeFunctionData, hexToString } from 'viem';
import { usesClassicStratHarvest1Abi } from '../config/classic/stratHarvest1';
import { classicVaultFactoryAbi } from '../effects/abis/beefy/classic/ClassicVaultFactory';
import { asHex } from './hex';

type RegisterContext = EvmContractRegisterContext;

/** A classic strategy is routed to the StratHarvest ABI variant it emits (config/classic/stratHarvest1). */
export const registerClassicStrategy = (context: RegisterContext, chainId: EvmChainId, address: string) => {
    context.chain.ClassicStrategy.add(asHex(address));
    if (usesClassicStratHarvest1Abi(chainId, address)) {
        context.chain.ClassicStrategyStratHarvest1.add(asHex(address));
    } else {
        context.chain.ClassicStrategyStratHarvest0.add(asHex(address));
    }
};

/**
 * ClassicVaultFactory `ProxyCreated` is emitted for vaults, strategies and boosts. `cloneVault` and `booooost` in the
 * transaction input pin the kind without an eth_call. Anything else is undefined: `cloneContract` clones any
 * implementation, and a factory called through another contract (multisig, deployer) does not decode.
 */
export const classifyFromInput = (input: string | undefined): 'VAULT' | 'BOOST' | undefined => {
    if (!input) return undefined;
    try {
        const { functionName } = decodeFunctionData({ abi: classicVaultFactoryAbi, data: input as `0x${string}` });
        if (functionName === 'cloneVault') return 'VAULT';
        if (functionName === 'booooost') return 'BOOST';
    } catch {
        // not a direct factory call
    }
    return undefined;
};

/** bytes32 name, right-padded with zero bytes. */
export const decodeBytes32Name = (value: string) =>
    hexToString(value as `0x${string}`, { size: 32 }).replace(/\0+$/, '');

/** Contract types a ClassicVaultFactory proxy can be routed to. */
const CLASSIC_PROXY_CONTRACTS = [
    ['ClassicVault', 'VAULT'],
    ['ClassicStrategy', 'STRATEGY'],
    ['ClassicBoost', 'BOOST'],
] as const;

const staticAddresses = new Map<string, ReadonlySet<string>>();
const staticSet = (chainId: EvmChainId, contract: (typeof CLASSIC_PROXY_CONTRACTS)[number][0]) => {
    const key = `${chainId}-${contract}`;
    let set = staticAddresses.get(key);
    if (!set) {
        set = new Set(indexer.chains[chainId][contract].addresses.map(asHex));
        staticAddresses.set(key, set);
    }
    return set;
};

/**
 * Kind of a ClassicVaultFactory proxy already listed in config.yaml (the known contracts generated from chain data by
 * scripts/knownContracts.ts): exactly one classic contract type lists it. Its events are already routed from the
 * chain start, so no candidate needs registering and no classification read is needed.
 */
export const staticClassicKind = (chainId: EvmChainId, address: string): 'VAULT' | 'STRATEGY' | 'BOOST' | undefined => {
    const kinds = CLASSIC_PROXY_CONTRACTS.filter(([contract]) => staticSet(chainId, contract).has(asHex(address)));
    return kinds.length === 1 ? kinds[0]?.[1] : undefined;
};
