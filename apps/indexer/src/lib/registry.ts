/**
 * Contract registry: `Contract`, `Token` and `ContractLink` rows.
 *
 * One-time on-chain facts (src/effects/facts.effects.ts) are read at `latest`, keyed on the address only, as soon
 * as the contract is known: at its factory creation event, or at the first handled event of an address listed in
 * config.yaml. They write the READ links and the Token rows and stamp `factsBlock`. An incomplete read (PARTIAL: a
 * missing link, or token metadata that could not be read) is retried by a later event, at most once per
 * FACTS_RETRY_BLOCKS. Later events only cost one `Contract.get`.
 *
 * Preload: the same code runs in the preload pass (reads and effects only: `set` is a no-op there), so the batch
 * issues its fact reads concurrently and deduplicated by key; the processing pass then reads them from memory and
 * writes once, at the first event that needs them (it sees the rows written by earlier events of the batch).
 */

import type { Contract, ContractLink, EvmChainId, EvmOnEventContext, Token } from 'envio';

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

/** Share tokens that are not ERC-20s: their metadata reads revert for good, so they do not keep the facts PARTIAL. */
const NON_ERC20_SHARE_KINDS: ReadonlySet<ContractKind> = new Set(['BOOST']);

type ReadLink = { relation: LinkRelation; to: string | undefined };

/** A PARTIAL fact read is retried by an event at least this many blocks after the previous read. */
const FACTS_RETRY_BLOCKS = 10_000n;

/** Blocks between two reads of a PARTIAL contract's facts (FACTS_RETRY_BLOCKS). */
export const factsRetryBlocks = (): bigint => FACTS_RETRY_BLOCKS;

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

/**
 * Writes the Token row; upgrades `isBeefyShare`, never downgrades it. Returns the row (stored or written). Metadata
 * read once is never read again. Metadata that could not be read (INVALID) is read again only with `retryInvalid`,
 * which only the facts retry passes (throttled by FACTS_RETRY_BLOCKS): the per-event callers must not pay a call on
 * every event for a token that really is not an ERC-20.
 */
const tokenRow = async (
    context: Context,
    chainId: number,
    address: string,
    isBeefyShare: boolean,
    retryInvalid = false
): Promise<Token> => {
    const id = contractId(chainId, address);
    const existing = await context.Token.get(id);
    const upgradesShare = isBeefyShare && existing?.isBeefyShare === false;
    if (existing && !upgradesShare && (existing.metadataStatus === 'OK' || !retryInvalid)) return existing;
    const metadata = await context.effect(getTokenMetadata, { address: asHex(address) });
    const token: Token = {
        id,
        address: asHex(address),
        decimals: metadata.decimals,
        symbol: metadata.symbol,
        name: metadata.name,
        metadataStatus: metadata.status === 'ok' ? 'OK' : 'INVALID',
        isBeefyShare: isBeefyShare || (existing?.isBeefyShare ?? false),
    };
    context.Token.set(token);
    return token;
};

/** `tokenRow`, returning whether the token's metadata is read. */
export const ensureToken = async (
    context: Context,
    chainId: number,
    address: string,
    isBeefyShare: boolean,
    retryInvalid = false
): Promise<boolean> => (await tokenRow(context, chainId, address, isBeefyShare, retryInvalid)).metadataStatus === 'OK';

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

/** Kinds priced by their own share price. */
const PRODUCT_KINDS: ReadonlySet<ContractKind> = new Set(['VAULT', 'CLM_MANAGER']);

/** The relation naming the product a staking contract is priced by. */
const STAKED_RELATIONS: Partial<Record<ContractKind, LinkRelation>> = {
    BOOST: 'BOOST_STAKED',
    REWARD_POOL: 'REWARD_POOL_STAKED',
};

type PriceFacts = Pick<Contract, 'priceDecimals' | 'productKind'>;

/**
 * Price decimals and kind of `product` (a staked token), the rule of productFactsSelect: a vault's or CLM's own price
 * decimals, the token's decimals for any other known kind, unknown for an unregistered or UNKNOWN contract.
 */
const stakedPriceFacts = async (
    context: Context,
    chainId: number,
    product: string
): Promise<PriceFacts | undefined> => {
    const row = await context.Contract.get(contractId(chainId, product));
    if (row === undefined || row.kind === 'UNKNOWN') return undefined;
    const priceDecimals = PRODUCT_KINDS.has(row.kind)
        ? row.priceDecimals
        : (await context.Token.get(contractId(chainId, product)))?.decimals;
    return priceDecimals === undefined ? undefined : { priceDecimals, productKind: row.kind };
};

/**
 * Price facts of a staking contract whose product is known but whose decimals are not yet (the product registered,
 * or its want read, after the stake's facts): one more `Contract.get` per event until they are.
 */
const completePriceFacts = async (context: Context, chainId: number, contract: Contract): Promise<Contract> => {
    if (contract.productAddress === undefined || contract.priceDecimals !== undefined) return contract;
    if (STAKED_RELATIONS[contract.kind] === undefined) return contract;
    const facts = await stakedPriceFacts(context, chainId, contract.productAddress);
    if (facts === undefined) return contract;
    const updated: Contract = { ...contract, ...facts };
    context.Contract.set(updated);
    return updated;
};

/**
 * Reads the contract's facts (at `latest`) and writes its Token rows and READ links. READ links start at the
 * contract's creation block when known (the facts are immutable since then), else at the reading event's block.
 * Sets the price facts: a vault is priced per its want's decimals, a CLM per its own, a stake per its product's.
 */
const applyFacts = async (context: Context, event: RawEvent, contract: Contract): Promise<Contract> => {
    const chainId = event.chainId;
    const links = await readFacts(context, contract.kind, contract.address);
    const [ownToken, ...linkTokens] = await Promise.all([
        SHARE_TOKEN_KINDS.has(contract.kind) ? tokenRow(context, chainId, contract.address, true, true) : undefined,
        ...links.map(({ relation, to }) =>
            to !== undefined && isTokenRelation(relation) ? tokenRow(context, chainId, to, false, true) : undefined
        ),
    ]);
    const tokensRead = [
        ownToken === undefined || ownToken.metadataStatus === 'OK' || NON_ERC20_SHARE_KINDS.has(contract.kind),
        ...links.map(
            ({ relation, to }, index) =>
                to === undefined || !isTokenRelation(relation) || linkTokens[index]?.metadataStatus === 'OK'
        ),
    ];
    const since = {
        block: contract.createdBlock ?? BigInt(event.block.number),
        timestamp: contract.createdTimestamp ?? blockTimestamp(event),
    };
    for (const { relation, to } of links) {
        if (to !== undefined) writeReadLink(context, contract, since, relation, to);
    }
    const linkIndex = links.findIndex(({ relation }) =>
        contract.kind === 'VAULT' ? relation === 'VAULT_WANT' : relation === STAKED_RELATIONS[contract.kind]
    );
    const linked = linkIndex === -1 ? undefined : links[linkIndex]?.to;
    const productAddress = PRODUCT_KINDS.has(contract.kind)
        ? contract.address
        : linked === undefined
          ? undefined
          : asHex(linked);
    const priceDecimals =
        contract.kind === 'VAULT'
            ? linkTokens[linkIndex]?.decimals
            : contract.kind === 'CLM_MANAGER'
              ? ownToken?.decimals
              : undefined;
    const updated: Contract = {
        ...contract,
        factsBlock: BigInt(event.block.number),
        factsStatus: links.every(({ to }) => to !== undefined) && tokensRead.every(Boolean) ? 'OK' : 'PARTIAL',
        // a later read never forgets a fact an earlier one found
        productAddress: productAddress ?? contract.productAddress,
        priceDecimals: priceDecimals ?? contract.priceDecimals,
        productKind: priceDecimals === undefined ? contract.productKind : contract.kind,
    };
    context.Contract.set(updated);
    return completePriceFacts(context, chainId, updated);
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
        productAddress: undefined,
        priceDecimals: undefined,
        productKind: undefined,
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
        productAddress: undefined,
        priceDecimals: undefined,
        productKind: undefined,
    };
    return needsFacts(contract, event.block.number)
        ? applyFacts(context, event, contract)
        : completePriceFacts(context, chainId, contract);
};
