/**
 * Known Beefy contracts in config.yaml. The `# generated` blocks (inside contract address lists) hold the known
 * contracts written by `scripts/knownContracts.ts`; this module routes, merges and extracts them.
 */
import * as R from 'remeda';

import { CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN } from '../src/config/classic/stratHarvest1/chains.ts';

export const CONFIG_FILE = 'config.yaml';

export const BEGIN_MARKER =
    '# generated: known contracts (scripts/knownContracts.ts), do not edit until the end marker';
export const END_MARKER = '# end generated';

// ---------------------------------------------------------------------------------------------------------------------
// Known contracts
// ---------------------------------------------------------------------------------------------------------------------

/** Kinds a known contract can be listed as (the registry kinds of src/lib/registry.ts). */
export type KnownKind = 'VAULT' | 'STRATEGY' | 'BOOST' | 'REWARD_POOL' | 'CLM_MANAGER' | 'CLM_STRATEGY';

export type KnownContract = { chainId: number; address: string; kind: KnownKind };

/** Config contract names a contract of each kind is routed to (the same as the factory `contractRegister` handlers). */
export const contractsForKind = (chainId: number, kind: KnownKind, address: string): string[] => {
    switch (kind) {
        case 'VAULT':
            return ['ClassicVault'];
        case 'STRATEGY': {
            const harvest1 = (CLASSIC_STRAT_HARVEST_1_FOR_ADDRESSES_BY_CHAIN as Record<number, readonly string[]>)[
                chainId
            ];
            const usesHarvest1 = harvest1?.some((item) => item.toLowerCase() === address.toLowerCase()) ?? false;
            return ['ClassicStrategy', usesHarvest1 ? 'ClassicStrategyStratHarvest1' : 'ClassicStrategyStratHarvest0'];
        }
        case 'BOOST':
            return ['ClassicBoost'];
        case 'REWARD_POOL':
            return ['RewardPool'];
        case 'CLM_MANAGER':
            return ['ClmManager'];
        case 'CLM_STRATEGY':
            return ['ClmStrategy'];
    }
};

/** chainId -> contract name -> sorted, unique, lowercase addresses. */
export type KnownAddresses = Map<number, Map<string, string[]>>;

type Routed = { chainId: number; contract: string; address: string };

const toKnownAddresses = (routed: Routed[]): KnownAddresses =>
    new Map(
        R.pipe(
            routed,
            R.groupBy((entry) => entry.chainId),
            R.entries(),
            R.map(([chainId, entries]): [number, Map<string, string[]>] => [
                Number(chainId),
                new Map(
                    R.pipe(
                        entries,
                        R.groupBy((entry) => entry.contract),
                        R.entries(),
                        R.map(([contract, items]): [string, string[]] => [
                            contract,
                            R.pipe(
                                items,
                                R.map((item) => item.address.toLowerCase()),
                                R.unique(),
                                R.sortBy((address) => address)
                            ),
                        ])
                    )
                ),
            ])
        )
    );

export const knownAddresses = (contracts: KnownContract[]): KnownAddresses =>
    toKnownAddresses(
        R.pipe(
            contracts,
            R.flatMap(({ chainId, address, kind }) =>
                R.pipe(
                    contractsForKind(chainId, kind, address),
                    R.map((contract) => ({ chainId, contract, address }))
                )
            )
        )
    );

const ADDRESS_LINE = /^ {10}- (0x[0-9a-fA-F]{40})\b/;

/**
 * Rewrites the generated block of every `chains[].contracts[].address` list: hand-listed addresses stay first and
 * untouched; known addresses not already hand-listed follow between the markers. Idempotent.
 */
export const mergeKnownContracts = (configYaml: string, known: KnownAddresses): string => {
    const lines = configYaml.split('\n');
    const out: string[] = [];
    let chainId: number | undefined;
    let contract: string | undefined;
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        const chainMatch = line.match(/^ {2}- id: (\d+)\b/);
        if (chainMatch) {
            chainId = Number(chainMatch[1]);
            contract = undefined;
        }
        const contractMatch = chainId !== undefined ? line.match(/^ {6}- name: (\w+)\s*$/) : null;
        if (contractMatch) contract = contractMatch[1];
        const isAddressKey = chainId !== undefined && contract !== undefined && /^ {8}address:( \[\])?\s*$/.test(line);
        if (!isAddressKey) {
            out.push(line);
            index++;
            continue;
        }
        // collect the list body (deeper indentation), dropping a previous generated block
        index++;
        const hand: string[] = [];
        let inGenerated = false;
        while (index < lines.length && /^ {10}/.test(lines[index])) {
            const item = lines[index];
            if (item.trim() === BEGIN_MARKER) inGenerated = true;
            else if (item.trim() === END_MARKER) inGenerated = false;
            else if (!inGenerated) hand.push(item);
            index++;
        }
        const handAddresses = R.pipe(
            hand,
            R.map((item) => item.match(ADDRESS_LINE)?.[1]?.toLowerCase()),
            R.filter((item) => item !== undefined)
        );
        const generated = R.pipe(
            known.get(chainId as number)?.get(contract as string) ?? [],
            R.filter((address) => !handAddresses.includes(address))
        );
        if (hand.length === 0 && generated.length === 0) {
            out.push('        address: []');
            continue;
        }
        out.push('        address:', ...hand);
        if (generated.length > 0) {
            out.push(
                `          ${BEGIN_MARKER}`,
                ...generated.map((address) => `          - ${address}`),
                `          ${END_MARKER}`
            );
        }
    }
    return out.join('\n');
};

/** The known contracts currently listed in config.yaml's generated blocks. */
export const extractKnownContracts = (configYaml: string): KnownAddresses => {
    const routed: Routed[] = [];
    let chainId: number | undefined;
    let contract: string | undefined;
    let inGenerated = false;
    for (const line of configYaml.split('\n')) {
        const chainMatch = line.match(/^ {2}- id: (\d+)\b/);
        if (chainMatch) chainId = Number(chainMatch[1]);
        const contractMatch = line.match(/^ {6}- name: (\w+)\s*$/);
        if (contractMatch) contract = contractMatch[1];
        if (line.trim() === BEGIN_MARKER) inGenerated = true;
        else if (line.trim() === END_MARKER) inGenerated = false;
        const address = line.match(ADDRESS_LINE)?.[1];
        if (inGenerated && address && chainId !== undefined && contract !== undefined) {
            routed.push({ chainId, contract, address });
        }
    }
    return toKnownAddresses(routed);
};
