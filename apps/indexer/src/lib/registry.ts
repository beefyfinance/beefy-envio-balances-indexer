/**
 * Contract registry: `Contract`, `Token` and `ContractLink` rows.
 *
 * One-time on-chain facts (src/effects/facts.effects.ts) are read at `latest`, keyed on the address only, as soon
 * as the contract is known: at its factory creation event, or at the first handled event of an address listed in
 * config.yaml. They write the READ links and the Token rows and stamp `factsBlock`. An incomplete read (PARTIAL) is
 * retried by a later event, at most once per FACTS_RETRY_BLOCKS. Later events only cost one `Contract.get`.
 *
 * Preload: the same code runs in the preload pass (reads and effects only: `set` is a no-op there), so the batch
 * issues its fact reads concurrently and deduplicated by key; the processing pass then reads them from memory and
 * writes once, at the first event that needs them (it sees the rows written by earlier events of the batch).
 */

import type { Contract, ContractLink, EvmChainId, EvmOnEventContext } from 'envio';

import {
    readAdapterFacts,
    readAssetFacts,
    readBoostFacts,
    readClmManagerFacts,
    readRewardPoolFacts,
    readStrategyFacts,
    readVaultFacts,
} from '../effects/facts.effects';
import { getTokenMetadata } from '../effects/token.effects';
import { isVaultBlacklisted } from './blacklist';
import { blockTimestamp, contractId, eventId, type RawEvent } from './event';
import { asHex } from './hex';

type ContractKind = Contract['kind'];
type LinkRelation = ContractLink['relation'];
type Context = EvmOnEventContext;

/** Kinds whose address is itself a share token (ERC-20 `Transfer`s of Beefy shares). */
const SHARE_TOKEN_KINDS: ReadonlySet<ContractKind> = new Set([
    'VAULT',
    // not an ERC-20 (metadata reads revert: Token.metadataStatus INVALID); the balances API treats it as a share
    'BOOST',
    'REWARD_POOL',
    'CLM_MANAGER',
    'ERC4626_ADAPTER',
    'LST_VAULT',
    'TOKEN',
]);

type ReadLink = { relation: LinkRelation; to: string | undefined };

/** A PARTIAL fact read is retried by an event at least this many blocks after the previous read. */
export const FACTS_RETRY_BLOCKS = 10_000n;

/** The one-time reads of each kind, as links. A missing `to` is a reverted / zero read. */
const readFacts = async (context: Context, kind: ContractKind, address: string): Promise<ReadLink[]> => {
    const input = { address: asHex(address) };
    switch (kind) {
        case 'VAULT': {
            // vault -> strategy history: STRATEGY_VAULT (strategy facts) and UpgradeStrat VAULT_STRATEGY events
            const facts = await context.effect(readVaultFacts, input);
            return [{ relation: 'VAULT_WANT', to: facts.want }];
        }
        case 'STRATEGY': {
            const facts = await context.effect(readStrategyFacts, { ...input, clm: false });
            return [{ relation: 'STRATEGY_VAULT', to: facts.vault }];
        }
        case 'CLM_STRATEGY': {
            const facts = await context.effect(readStrategyFacts, { ...input, clm: true });
            return [
                { relation: 'CLM_STRATEGY_MANAGER', to: facts.vault },
                { relation: 'CLM_POOL', to: facts.pool },
            ];
        }
        case 'BOOST': {
            const facts = await context.effect(readBoostFacts, input);
            return [
                { relation: 'BOOST_STAKED', to: facts.stakedToken },
                { relation: 'BOOST_REWARD', to: facts.rewardToken },
            ];
        }
        case 'REWARD_POOL': {
            const facts = await context.effect(readRewardPoolFacts, input);
            return [{ relation: 'REWARD_POOL_STAKED', to: facts.stakedToken }];
        }
        case 'CLM_MANAGER': {
            const facts = await context.effect(readClmManagerFacts, input);
            return [
                { relation: 'CLM_WANT0', to: facts.want0 },
                { relation: 'CLM_WANT1', to: facts.want1 },
            ];
        }
        case 'ERC4626_ADAPTER': {
            const facts = await context.effect(readAdapterFacts, input);
            return [{ relation: 'ADAPTER_VAULT', to: facts.vault }];
        }
        case 'LST_VAULT': {
            const facts = await context.effect(readAssetFacts, input);
            return [{ relation: 'VAULT_WANT', to: facts.asset }];
        }
        case 'TOKEN':
        case 'SWAPPER':
        case 'UNKNOWN':
            return [];
    }
};

/** Relations whose target is a token (gets a Token row with metadata). */
const TOKEN_RELATIONS: ReadonlySet<LinkRelation> = new Set([
    'VAULT_WANT',
    'BOOST_STAKED',
    'BOOST_REWARD',
    'REWARD_POOL_STAKED',
    'REWARD_POOL_REWARD',
    'CLM_WANT0',
    'CLM_WANT1',
    'ADAPTER_VAULT',
]);

const isTokenRelation = (relation: LinkRelation) => TOKEN_RELATIONS.has(relation);

/** Writes the Token row once (metadata read once per token); upgrades `isBeefyShare`, never downgrades it. */
export const ensureToken = async (context: Context, chainId: number, address: string, isBeefyShare: boolean) => {
    const id = contractId(chainId, address);
    const [existing, metadata] = await Promise.all([
        context.Token.get(id),
        context.effect(getTokenMetadata, { address: asHex(address) }),
    ]);
    if (existing && (existing.isBeefyShare || !isBeefyShare)) return;
    context.Token.set({
        id,
        address: asHex(address),
        decimals: metadata.decimals,
        symbol: metadata.symbol,
        name: metadata.name,
        metadataStatus: metadata.status === 'ok' ? 'OK' : 'INVALID',
        isBeefyShare: isBeefyShare || (existing?.isBeefyShare ?? false),
    });
};

/** Appends a link discovered from an event (UpgradeStrat, AddReward). */
export const writeEventLink = (context: Context, event: RawEvent, relation: LinkRelation, to: string) => {
    context.ContractLink.set({
        id: `${eventId(event)}-${relation}`,
        fromAddress: asHex(event.srcAddress),
        toAddress: asHex(to),
        relation,
        source: 'EVENT',
        sinceBlock: BigInt(event.block.number),
        sinceTimestamp: blockTimestamp(event),
        trxHash: asHex(event.transaction.hash),
        logIndex: event.logIndex,
    });
};

const writeReadLink = (
    context: Context,
    contract: Contract,
    since: { block: bigint; timestamp: Date },
    relation: LinkRelation,
    to: string
) => {
    context.ContractLink.set({
        id: `${contract.id}-${relation}-read`,
        fromAddress: contract.address,
        toAddress: asHex(to),
        relation,
        source: 'READ',
        sinceBlock: since.block,
        sinceTimestamp: since.timestamp,
        trxHash: undefined,
        logIndex: undefined,
    });
};

const needsFacts = (contract: Contract, block: number) =>
    contract.kind !== 'UNKNOWN' &&
    (contract.factsBlock === undefined ||
        (contract.factsStatus === 'PARTIAL' && BigInt(block) >= contract.factsBlock + FACTS_RETRY_BLOCKS));

/**
 * Reads the contract's facts (at `latest`) and writes its Token rows and READ links. READ links start at the
 * contract's creation block when known (the facts are immutable since then), else at the reading event's block.
 */
const applyFacts = async (context: Context, event: RawEvent, contract: Contract): Promise<Contract> => {
    const chainId = event.chainId;
    const links = await readFacts(context, contract.kind, contract.address);
    await Promise.all([
        SHARE_TOKEN_KINDS.has(contract.kind) ? ensureToken(context, chainId, contract.address, true) : undefined,
        ...links.map(({ relation, to }) =>
            to !== undefined && isTokenRelation(relation) ? ensureToken(context, chainId, to, false) : undefined
        ),
    ]);
    const since = {
        block: contract.createdBlock ?? BigInt(event.block.number),
        timestamp: contract.createdTimestamp ?? blockTimestamp(event),
    };
    for (const { relation, to } of links) {
        if (to !== undefined) writeReadLink(context, contract, since, relation, to);
    }
    const updated: Contract = {
        ...contract,
        factsBlock: BigInt(event.block.number),
        factsStatus: links.every(({ to }) => to !== undefined) ? 'OK' : 'PARTIAL',
    };
    context.Contract.set(updated);
    return updated;
};

/**
 * Contract row from a factory creation event, with its facts. First established kind wins: an existing row is
 * only replaced when its kind is UNKNOWN and the new one is not (a ContractDeployed row, or a failed
 * classification, never overwrites a kind established by a Beefy factory event or a classification read).
 */
export const registerCreatedContract = async (
    context: Context,
    event: RawEvent,
    { address, kind, deployName }: { address: string; kind: ContractKind; deployName?: string | undefined }
) => {
    const id = contractId(event.chainId, address);
    const existing = await context.Contract.get(id);
    if (existing && (existing.kind !== 'UNKNOWN' || kind === 'UNKNOWN')) return existing;
    const contract: Contract = {
        id,
        address: asHex(address),
        kind,
        factory: asHex(event.srcAddress),
        createdBlock: BigInt(event.block.number),
        createdTimestamp: blockTimestamp(event),
        createdTrxHash: asHex(event.transaction.hash),
        deployName: deployName ?? existing?.deployName,
        factsBlock: undefined,
        factsStatus: undefined,
    };
    context.Contract.set(contract);
    return needsFacts(contract, event.block.number) ? applyFacts(context, event, contract) : contract;
};

/**
 * Registry guard of every product handler. Returns undefined when the event must not produce rows: blacklisted
 * contract, or an address whose established kind is another one (ClassicVaultFactory proxies registered under
 * every candidate contract type, see factories.handlers.ts). Reads the facts of an address listed in config.yaml
 * at its first event, and retries a PARTIAL read at most once per FACTS_RETRY_BLOCKS.
 */
export const ensureContract = async (
    context: Context,
    event: RawEvent,
    kind: ContractKind
): Promise<Contract | undefined> => {
    const chainId = event.chainId as EvmChainId;
    if (isVaultBlacklisted(chainId, event.srcAddress)) return undefined;

    const id = contractId(chainId, event.srcAddress);
    const existing = await context.Contract.get(id);
    if (existing && existing.kind !== kind) return undefined;
    const contract: Contract = existing ?? {
        id,
        address: asHex(event.srcAddress),
        kind,
        factory: undefined,
        createdBlock: undefined,
        createdTimestamp: undefined,
        createdTrxHash: undefined,
        deployName: undefined,
        factsBlock: undefined,
        factsStatus: undefined,
    };
    return needsFacts(contract, event.block.number) ? applyFacts(context, event, contract) : contract;
};
