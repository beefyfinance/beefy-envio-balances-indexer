/**
 * Registry and links (docs/architecture.md "Registry and on-chain facts"): factory events -> Contract rows,
 * dynamic registration, ContractLink rows (READ facts, UpgradeStrat / AddReward history), ClassicVaultFactory
 * proxy classification, kind guard. Expected link targets are on-chain reads made outside the indexer.
 */
import { indexer as configured, createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';
import { latestById, registrationsOf, rowsOf } from '../helpers/simulate';
import { fakeHash, strategyCreated, transferItem, vaultCreated, vaultInitialized } from './harness';
import {
    CHAIN,
    CLASSIC_VAULT_FACTORY,
    CLM,
    CLM_MANAGER_FACTORY,
    CLM_STRATEGY_FACTORY,
    DEPLOYER,
    REWARD_POOL_FACTORY,
    STRATEGY,
    VAULT,
} from './realData';

type ContractRow = {
    id: string;
    address: string;
    kind: string;
    factory?: string;
    createdBlock?: bigint;
    createdTimestamp?: Date;
    createdTrxHash?: string;
    deployName?: string;
    factsBlock?: bigint;
    factsStatus?: string;
};
type LinkRow = {
    id: string;
    fromAddress: string;
    toAddress: string;
    relation: string;
    source: string;
    sinceBlock: bigint;
    sinceTimestamp: Date;
    trxHash?: string;
    logIndex?: number;
};
type TokenRow = {
    id: string;
    address: string;
    decimals?: number;
    symbol?: string;
    name?: string;
    metadataStatus: string;
    isBeefyShare: boolean;
};

const V = VAULT.address;
const S = STRATEGY.address;
/** want of vault V (on-chain `want()` from block 25058971, when strategy S was initialized). */
const V_WANT = '0xac4e562d7c6108f971321f14238e24ae2cc398ac';
const AERO = '0x940181a94a35a4569e4529a3cdfb74e38fd98631';
const WETH = '0x4200000000000000000000000000000000000006';
const CLM_WANT1 = '0x9d0e8f5b25384c7310cb8c6ae32c8fbeb645d083';
const CLM_POOL = '0xa0e2bac96ab51c92d3284781aee1eec817f6f9c2';

/** Known contracts generated from chain data (scripts/knownContracts.ts) are static in config.yaml. */
const staticOn = (contract: 'ClassicVault' | 'ClassicStrategy' | 'ClassicBoost', address: string) =>
    configured.chains[CHAIN][contract].addresses.map((a) => a.toLowerCase()).includes(address);

const linksFrom = (links: LinkRow[], from: string) => links.filter((l) => l.fromAddress === from);

describe('ClassicVaultFactory ProxyCreated (real Base txs)', () => {
    it('cloneVault input -> Contract kind VAULT with creation columns, routed as ClassicVault only', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({ chains: { [CHAIN]: { simulate: [vaultCreated()] } } });
        const contract = latestById<ContractRow>(result, 'Contract').get(`${CHAIN}-${V}`);
        expect(contract).toMatchObject({
            address: V,
            kind: 'VAULT',
            factory: CLASSIC_VAULT_FACTORY,
            createdBlock: BigInt(VAULT.creation.block),
            createdTimestamp: new Date(VAULT.creation.timestamp * 1000),
            createdTrxHash: VAULT.creation.hash,
        });
        // V is a known contract, static as ClassicVault: its re-registration is a no-op (no new routing)
        expect(staticOn('ClassicVault', V)).toBe(true);
        expect(staticOn('ClassicStrategy', V) || staticOn('ClassicBoost', V)).toBe(false);
        expect(registrationsOf(result).filter((r) => r.address === V)).toEqual([]);
    });

    it('cloneContract input -> Contract kind STRATEGY; a known strategy registers no candidate', async () => {
        // cloneContract clones any implementation: the input does not pin the kind. S is a known contract (static
        // ClassicStrategy, classified from chain data), so no candidate is registered and no read is needed.
        const indexer = createTestIndexer();
        const result = await indexer.process({ chains: { [CHAIN]: { simulate: [strategyCreated()] } } });
        expect(latestById<ContractRow>(result, 'Contract').get(`${CHAIN}-${S}`)?.kind).toBe('STRATEGY');
        expect(staticOn('ClassicStrategy', S)).toBe(true);
        expect(registrationsOf(result).filter((r) => r.address === S)).toEqual([]);
    });

    it('undecodable input (multisig call): classified by on-chain read at the creation block', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: { [CHAIN]: { simulate: [vaultCreated(false), strategyCreated(false)] } },
        });
        const contracts = latestById<ContractRow>(result, 'Contract');
        expect(contracts.get(`${CHAIN}-${V}`)?.kind).toBe('VAULT');
        expect(contracts.get(`${CHAIN}-${S}`)?.kind).toBe('STRATEGY');
    });

    it('undecodable input for a known contract: kind from the static list, no candidate routed', async () => {
        // The multi-type routing and its kind guard apply to proxies not listed in config.yaml
        // (src/handlers/factories.test.ts covers them); known contracts are routed as their kind only.
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: { [CHAIN]: { simulate: [vaultCreated(false), vaultInitialized()] } },
        });
        const contract = latestById<ContractRow>(result, 'Contract').get(`${CHAIN}-${V}`);
        expect(contract?.kind).toBe('VAULT');
        expect(registrationsOf(result)).toEqual([]);
        const links = rowsOf<LinkRow>(result, 'ContractLink');
        expect(links.map((l) => l.relation)).not.toContain('STRATEGY_VAULT');
        expect(links.map((l) => l.relation)).not.toContain('BOOST_STAKED');
    });
});

describe('one-time facts (READ links, Token rows)', () => {
    it('vault: VAULT_WANT READ link, strategy history from STRATEGY_VAULT, Token rows for share and want', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: { [CHAIN]: { simulate: [vaultCreated(), strategyCreated(), vaultInitialized()] } },
        });
        const links = linksFrom(rowsOf<LinkRow>(result, 'ContractLink'), V);
        // vault.strategy() is not read: the strategy's vault() gives the link, from the strategy's creation block
        expect(links.find((l) => l.relation === 'VAULT_STRATEGY')).toBeUndefined();
        expect(
            linksFrom(rowsOf<LinkRow>(result, 'ContractLink'), S).find((l) => l.relation === 'STRATEGY_VAULT')
        ).toMatchObject({ toAddress: V, source: 'READ', sinceBlock: BigInt(STRATEGY.creation.block) });
        // Real deploy order: vault initialized (25058965) before its strategy (25058971); want() is 0x0 until then.
        // The spec lists vault want() as a once-per-contract fact: the indexer must still end up with the link.
        expect(links.find((l) => l.relation === 'VAULT_WANT')?.toAddress).toBe(V_WANT);
        const contract = latestById<ContractRow>(result, 'Contract').get(`${CHAIN}-${V}`);
        expect(contract?.factsStatus).toBe('OK');
    });

    it('vault share Token row: on-chain metadata, isBeefyShare', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: { [CHAIN]: { simulate: [vaultCreated(), vaultInitialized()] } },
        });
        expect(latestById<TokenRow>(result, 'Token').get(`${CHAIN}-${V}`)).toMatchObject({
            address: V,
            decimals: 18,
            symbol: 'mooAerodromeBaseWETH-DRV',
            name: 'Moo Aerodrome Base WETH-DRV',
            metadataStatus: 'OK',
            isBeefyShare: true,
        });
    });

    it('strategy: STRATEGY_VAULT READ link from the strategy creation block', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        strategyCreated(),
                        {
                            contract: 'ClassicStrategy',
                            event: 'Initialized',
                            srcAddress: S,
                            logIndex: 351,
                            block: { number: 25058971, timestamp: 1736907289 },
                            transaction: {
                                hash: '0xa41f4930aa8860b15bd2a55d1b8b1de3b26f362676aadea6e6b0f46fa1f3c2ec',
                                from: DEPLOYER,
                            },
                            params: { version: 1n },
                        },
                    ],
                },
            },
        });
        const link = linksFrom(rowsOf<LinkRow>(result, 'ContractLink'), S).find((l) => l.relation === 'STRATEGY_VAULT');
        expect(link).toMatchObject({ toAddress: V, source: 'READ', sinceBlock: BigInt(STRATEGY.creation.block) });
    });

    it('CLM manager: CLM_WANT0 / CLM_WANT1 from wants(); CLM strategy: CLM_STRATEGY_MANAGER, CLM_POOL', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        {
                            contract: 'ClmManagerFactory',
                            event: 'ClmManagerCreated',
                            srcAddress: CLM_MANAGER_FACTORY,
                            logIndex: CLM.managerCreation.logIndex,
                            block: { number: CLM.managerCreation.block, timestamp: 1736018000 },
                            transaction: { hash: CLM.managerCreation.hash, from: DEPLOYER },
                            params: { proxy: CLM.manager },
                        },
                        {
                            contract: 'ClmStrategyFactory',
                            event: 'ClmStrategyCreatedWithName',
                            srcAddress: CLM_STRATEGY_FACTORY,
                            logIndex: CLM.strategyCreation.logIndex,
                            block: { number: CLM.strategyCreation.block, timestamp: 1736018006 },
                            transaction: { hash: CLM.strategyCreation.hash, from: DEPLOYER },
                            params: { proxy: CLM.strategy, strategyName: 'StrategyPassiveManagerUniswap' },
                        },
                        // real Initialized logs of the manager (25114363) and the strategy (25114369)
                        {
                            contract: 'ClmManager',
                            event: 'Initialized',
                            srcAddress: CLM.manager,
                            logIndex: 335,
                            block: { number: 25114363, timestamp: 1736018018 },
                            transaction: { hash: fakeHash(301), from: DEPLOYER },
                            params: { version: 1n },
                        },
                        {
                            contract: 'ClmStrategy',
                            event: 'Initialized',
                            srcAddress: CLM.strategy,
                            logIndex: 340,
                            block: { number: 25114369, timestamp: 1736018030 },
                            transaction: { hash: fakeHash(302), from: DEPLOYER },
                            params: { version: 1n },
                        },
                    ],
                },
            },
        });
        const contracts = latestById<ContractRow>(result, 'Contract');
        expect(contracts.get(`${CHAIN}-${CLM.strategy}`)).toMatchObject({
            kind: 'CLM_STRATEGY',
            deployName: 'StrategyPassiveManagerUniswap',
            factory: CLM_STRATEGY_FACTORY,
            createdBlock: BigInt(CLM.strategyCreation.block),
        });
        const links = rowsOf<LinkRow>(result, 'ContractLink');
        const strategyLinks = linksFrom(links, CLM.strategy);
        expect(strategyLinks.find((l) => l.relation === 'CLM_STRATEGY_MANAGER')?.toAddress).toBe(CLM.manager);
        expect(strategyLinks.find((l) => l.relation === 'CLM_POOL')?.toAddress).toBe(CLM_POOL);
        // wants() is 0x0 at the manager's Initialized block (strategy initialized 6 blocks later)
        const managerLinks = linksFrom(links, CLM.manager);
        expect(managerLinks.find((l) => l.relation === 'CLM_WANT0')?.toAddress).toBe(WETH);
        expect(managerLinks.find((l) => l.relation === 'CLM_WANT1')?.toAddress).toBe(CLM_WANT1);
    });
});

describe('event links (history preserved)', () => {
    it('UpgradeStrat appends a VAULT_STRATEGY EVENT link and registers the new strategy', async () => {
        const NEW_STRATEGY = CLM.clmVaultStrategy; // a real strategy deployed at 25114389
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        vaultCreated(),
                        vaultInitialized(),
                        {
                            contract: 'ClassicVault',
                            event: 'UpgradeStrat',
                            srcAddress: V,
                            logIndex: 7,
                            block: { number: 25120000, timestamp: 1736030000 },
                            transaction: { hash: fakeHash(400), from: DEPLOYER },
                            params: { implementation: NEW_STRATEGY },
                        },
                        // the new strategy's events are now indexed
                        {
                            contract: 'ClassicStrategy',
                            event: 'ChargedFeesV2',
                            srcAddress: NEW_STRATEGY,
                            logIndex: 3,
                            block: { number: 25120005, timestamp: 1736030010 },
                            transaction: { hash: fakeHash(401), from: DEPLOYER },
                            params: { callFees: 1n, beefyFees: 2n, strategistFees: 3n },
                        },
                    ],
                },
            },
        });
        // the new strategy is routed: registered by UpgradeStrat, or already static as a known contract
        expect(
            staticOn('ClassicStrategy', NEW_STRATEGY) ||
                registrationsOf(result)
                    .filter((r) => r.address === NEW_STRATEGY)
                    .map((r) => r.contract)
                    .includes('ClassicStrategy')
        ).toBe(true);
        const links = linksFrom(rowsOf<LinkRow>(result, 'ContractLink'), V).filter(
            (l) => l.relation === 'VAULT_STRATEGY'
        );
        // vault.strategy() is not read (no READ VAULT_STRATEGY link): history = STRATEGY_VAULT + UpgradeStrat events
        expect(links).toHaveLength(1);
        expect(links.find((l) => l.source === 'EVENT')).toMatchObject({
            toAddress: NEW_STRATEGY,
            sinceBlock: 25120000n,
            sinceTimestamp: new Date(1736030000 * 1000),
            trxHash: fakeHash(400),
            logIndex: 7,
        });
        expect(rowsOf(result, 'FeesCharged')).toHaveLength(1);
        expect(latestById<ContractRow>(result, 'Contract').get(`${CHAIN}-${NEW_STRATEGY}`)?.kind).toBe('STRATEGY');
    });

    it('reward pool: created WithName, REWARD_POOL_STAKED READ link, AddReward appends REWARD_POOL_REWARD links', async () => {
        const OTHER_REWARD = WETH;
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        {
                            contract: 'RewardPoolFactory',
                            event: 'RewardPoolCreatedWithName',
                            srcAddress: REWARD_POOL_FACTORY,
                            logIndex: CLM.rewardPoolCreation.logIndex,
                            block: { number: CLM.rewardPoolCreation.block, timestamp: 1736018012 },
                            transaction: { hash: CLM.rewardPoolCreation.hash, from: DEPLOYER },
                            params: { proxy: CLM.rewardPool, rewardPoolName: 'Beefy Reward Pool' },
                        },
                        // real AddReward (block 25115953 log 381)
                        {
                            contract: 'RewardPool',
                            event: 'AddReward',
                            srcAddress: CLM.rewardPool,
                            logIndex: 381,
                            block: { number: 25115953, timestamp: 1736021200 },
                            transaction: {
                                hash: '0xd24407202be4bfaec096f8caa1e471c91cbf09b7e96a0fe9a261cf06d01baae5',
                                from: DEPLOYER,
                            },
                            params: { reward: AERO },
                        },
                        {
                            contract: 'RewardPool',
                            event: 'AddReward',
                            srcAddress: CLM.rewardPool,
                            logIndex: 9,
                            block: { number: 25200000, timestamp: 1736190000 },
                            transaction: { hash: fakeHash(500), from: DEPLOYER },
                            params: { reward: OTHER_REWARD },
                        },
                    ],
                },
            },
        });
        expect(latestById<ContractRow>(result, 'Contract').get(`${CHAIN}-${CLM.rewardPool}`)).toMatchObject({
            kind: 'REWARD_POOL',
            deployName: 'Beefy Reward Pool',
            factory: REWARD_POOL_FACTORY,
        });
        const links = linksFrom(rowsOf<LinkRow>(result, 'ContractLink'), CLM.rewardPool);
        expect(links.find((l) => l.relation === 'REWARD_POOL_STAKED')).toMatchObject({
            toAddress: CLM.manager,
            source: 'READ',
        });
        const rewards = links.filter((l) => l.relation === 'REWARD_POOL_REWARD');
        expect(rewards.map((l) => [l.toAddress, l.sinceBlock, l.source])).toEqual([
            [AERO, 25115953n, 'EVENT'],
            [OTHER_REWARD, 25200000n, 'EVENT'],
        ]);
        const tokens = latestById<TokenRow>(result, 'Token');
        expect(tokens.get(`${CHAIN}-${AERO}`)).toMatchObject({ symbol: 'AERO', decimals: 18, isBeefyShare: false });
        expect(tokens.get(`${CHAIN}-${CLM.rewardPool}`)?.isBeefyShare).toBe(true);
    });

    it('a share token that is also a link target keeps isBeefyShare = true (never downgraded)', async () => {
        // reward pool stakes CLM manager shares: the manager Token row is both a share and a REWARD_POOL_STAKED target
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        {
                            contract: 'ClmManagerFactory',
                            event: 'ClmManagerCreated',
                            srcAddress: CLM_MANAGER_FACTORY,
                            logIndex: CLM.managerCreation.logIndex,
                            block: { number: CLM.managerCreation.block, timestamp: 1736018000 },
                            transaction: { hash: CLM.managerCreation.hash, from: DEPLOYER },
                            params: { proxy: CLM.manager },
                        },
                        {
                            contract: 'RewardPoolFactory',
                            event: 'RewardPoolCreatedWithName',
                            srcAddress: REWARD_POOL_FACTORY,
                            logIndex: CLM.rewardPoolCreation.logIndex,
                            block: { number: CLM.rewardPoolCreation.block, timestamp: 1736018012 },
                            transaction: { hash: CLM.rewardPoolCreation.hash, from: DEPLOYER },
                            params: { proxy: CLM.rewardPool, rewardPoolName: 'Beefy Reward Pool' },
                        },
                        {
                            contract: 'ClmManager',
                            event: 'Initialized',
                            srcAddress: CLM.manager,
                            logIndex: 335,
                            block: { number: 25114363, timestamp: 1736018018 },
                            transaction: { hash: fakeHash(601), from: DEPLOYER },
                            params: { version: 1n },
                        },
                        {
                            contract: 'RewardPool',
                            event: 'Initialized',
                            srcAddress: CLM.rewardPool,
                            logIndex: 161,
                            block: { number: 25114372, timestamp: 1736018036 },
                            transaction: { hash: fakeHash(602), from: DEPLOYER },
                            params: { version: 1n },
                        },
                    ],
                },
            },
        });
        expect(latestById<TokenRow>(result, 'Token').get(`${CHAIN}-${CLM.manager}`)?.isBeefyShare).toBe(true);
    });
});

describe('dynamic registration', () => {
    it('a Transfer on a factory-created vault in a later block is indexed', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                [CHAIN]: {
                    simulate: [
                        vaultCreated(),
                        transferItem('ClassicVault', V, {
                            block: 25059209,
                            timestamp: 1736907765,
                            logIndex: 232,
                            hash: '0xca2e9baa4518e5f6cfbcdc80d4f2b8595f1c07e1510d244fce75e198edae3108',
                            txFrom: DEPLOYER,
                            from: '0x0000000000000000000000000000000000000000',
                            to: DEPLOYER,
                            value: 32410436034212669n,
                        }),
                    ],
                },
            },
        });
        expect(rowsOf(result, 'ShareTransfer')).toHaveLength(1);
        // facts (read at latest) are read at the factory creation event; Contract keeps factory columns
        expect(latestById<ContractRow>(result, 'Contract').get(`${CHAIN}-${V}`)).toMatchObject({
            kind: 'VAULT',
            factory: CLASSIC_VAULT_FACTORY,
            createdBlock: BigInt(VAULT.creation.block),
            factsBlock: BigInt(VAULT.creation.block),
        });
    });
});
