import { createTestIndexer } from 'envio';
import { encodeFunctionData, type Hex, stringToHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { latestById, registrationsOf, rowsOf, tx, USER_A, ZERO } from '../../test/helpers/simulate';
import { classicVaultFactoryAbi } from '../effects/abis/beefy/classic/ClassicVaultFactory';
import { classifyFromInput, decodeBytes32Name } from '../lib/register';

const BSC_VAULT_FACTORY = '0xe596ec590de52c09c8d1c7a1294b32f957a7c94e' as const;
const BSC_STRATEGY_FACTORY = '0x8b93779aa8613d9542bcd5e153d536ba5b9039f2' as const;
const BASE_REWARD_POOL_FACTORY = '0x13f518aa15ca3296e51ceafb44a8d86660e97b3a' as const;
const BASE_ADAPTER_FACTORY = '0x917447f8f52e7db26ce7f52be2f3fcb4d4d00832' as const;
// real BSC vault (October 2021)
const VAULT = '0xba53af4c2f1649f82e8070fb306ddbf2771a1950' as const;
const BLOCK = 12_132_390;
const TS = Math.floor(Date.parse('2021-10-27T09:56:05.000Z') / 1000);
const PROXY = '0x00000000000000000000000000000000deadbeef' as const;
const BASE_VAULT_FACTORY = '0xbc4a342b0c057501e081484a2d24e576e854f823' as const;
// Base ERC-4626 adapter (not in the static lists): answers only vault(), the Beefy vault it wraps
const UNLISTED = '0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5' as const;
const UNLISTED_VAULT = '0xef6ed674486e54507d0f711c0d388bd8a1552e6f' as const;

const cloneVault = encodeFunctionData({ abi: classicVaultFactoryAbi, functionName: 'cloneVault', args: [] });
const cloneContract = encodeFunctionData({
    abi: classicVaultFactoryAbi,
    functionName: 'cloneContract',
    args: [PROXY],
});

const vaultFactoryEvent = (proxy: Hex, input: Hex, logIndex = 1) => ({
    contract: 'ClassicVaultFactory' as const,
    event: 'VaultOrStrategyCreated' as const,
    srcAddress: BSC_VAULT_FACTORY,
    logIndex,
    block: { number: BLOCK, timestamp: TS },
    transaction: { ...tx(logIndex), input },
    params: { proxy },
});

describe('ClassicVaultFactory classification', () => {
    it('decodes the factory call from the transaction input', () => {
        expect(classifyFromInput(cloneVault)).toBe('VAULT');
        // cloneContract clones any implementation: the kind comes from the classification read
        expect(classifyFromInput(cloneContract)).toBeUndefined();
        expect(
            classifyFromInput(
                encodeFunctionData({ abi: classicVaultFactoryAbi, functionName: 'booooost', args: [PROXY, PROXY, 1n] })
            )
        ).toBe('BOOST');
        expect(classifyFromInput('0x')).toBeUndefined();
        expect(classifyFromInput('0x12345678')).toBeUndefined();
        expect(classifyFromInput(undefined)).toBeUndefined();
        expect(decodeBytes32Name(stringToHex('BeefyZapRouter', { size: 32 }))).toBe('BeefyZapRouter');
    });

    it('registers only the decoded kind and writes the Contract row', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: { 56: { simulate: [vaultFactoryEvent(PROXY, cloneVault)] } },
        });
        expect(registrationsOf(result)).toEqual([{ address: PROXY, contract: 'ClassicVault' }]);
        expect(rowsOf(result, 'Contract')).toEqual([
            {
                id: `56-${PROXY}`,
                address: PROXY,
                kind: 'VAULT',
                factory: BSC_VAULT_FACTORY,
                createdBlock: BigInt(BLOCK),
                createdTimestamp: new Date(TS * 1000),
                createdTrxHash: tx(1).hash,
                deployName: undefined,
                // facts read at the creation event; this fake proxy has no code
                factsBlock: BigInt(BLOCK),
                factsStatus: 'PARTIAL',
            },
        ]);
    });

    it('registers every candidate for an undecodable input, classifies with one read, and skips other kinds', async () => {
        // A proxy that is not a known (static) contract and answers only vault(): an ERC-4626 adapter stands in for
        // an unlisted strategy (known strategies are static and need no candidate registration).
        const indexer = createTestIndexer();
        const block = { number: 13_521_369, timestamp: TS };
        const result = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        {
                            contract: 'ClassicVaultFactory',
                            event: 'VaultOrStrategyCreated',
                            srcAddress: BASE_VAULT_FACTORY,
                            logIndex: 1,
                            block,
                            transaction: { ...tx(1), input: '0x' },
                            params: { proxy: UNLISTED },
                        },
                        // the same log reaches every registered contract; only the classified kind writes rows
                        {
                            contract: 'ClassicVault',
                            event: 'Initialized',
                            srcAddress: UNLISTED,
                            logIndex: 2,
                            block,
                            transaction: tx(2),
                            params: { version: 1n },
                        },
                        {
                            contract: 'ClassicStrategy',
                            event: 'Initialized',
                            srcAddress: UNLISTED,
                            logIndex: 3,
                            block,
                            transaction: tx(2),
                            params: { version: 1n },
                        },
                    ],
                },
            },
        });
        expect(registrationsOf(result)).toEqual([
            { address: UNLISTED, contract: 'ClassicVault' },
            { address: UNLISTED, contract: 'ClassicStrategy' },
            { address: UNLISTED, contract: 'ClassicStrategyStratHarvest0' },
            { address: UNLISTED, contract: 'ClassicBoost' },
        ]);
        expect(latestById(result, 'Contract').get(`8453-${UNLISTED}`)).toMatchObject({
            kind: 'STRATEGY',
            factory: BASE_VAULT_FACTORY,
            factsBlock: BigInt(block.number),
            factsStatus: 'OK',
        });
        expect(
            rowsOf<{ relation: string; toAddress: string }>(result, 'ContractLink').map(({ relation, toAddress }) => [
                relation,
                toAddress,
            ])
        ).toEqual([['STRATEGY_VAULT', UNLISTED_VAULT]]);
    });

    it('classifies a vault proxy with the same read', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({ chains: { 56: { simulate: [vaultFactoryEvent(VAULT, '0x')] } } });
        expect(latestById(result, 'Contract').get(`56-${VAULT}`)).toMatchObject({ kind: 'VAULT' });
    });
});

describe('other factories', () => {
    it('registers named strategies with their deploy name', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                56: {
                    simulate: [
                        {
                            contract: 'ClassicStrategyFactory',
                            event: 'StrategyCreatedWithName',
                            srcAddress: BSC_STRATEGY_FACTORY,
                            logIndex: 1,
                            block: { number: BLOCK, timestamp: TS },
                            transaction: tx(1),
                            params: { strategyName: 'StrategyCommonChefLP', proxy: PROXY },
                        },
                    ],
                },
            },
        });
        expect(registrationsOf(result)).toEqual([
            { address: PROXY, contract: 'ClassicStrategy' },
            { address: PROXY, contract: 'ClassicStrategyStratHarvest0' },
        ]);
        expect(rowsOf(result, 'Contract')).toEqual([
            expect.objectContaining({
                kind: 'STRATEGY',
                deployName: 'StrategyCommonChefLP',
                factory: BSC_STRATEGY_FACTORY,
            }),
        ]);
    });

    it('does not route ContractDeployed from an address that is not a configured ContractFactory', async () => {
        // ContractFactory is address-bound (no wildcard), so a foreign emitter never reaches the handler
        const indexer = createTestIndexer();
        const processing = indexer.process({
            chains: {
                8453: {
                    simulate: [
                        {
                            contract: 'ContractFactory',
                            event: 'ContractDeployed',
                            srcAddress: '0x2222222222222222222222222222222222222222',
                            logIndex: 1,
                            block: { number: 20_000_000, timestamp: TS },
                            transaction: tx(1),
                            params: { contractName: stringToHex('BeefyZapRouter', { size: 32 }), proxy: PROXY },
                        },
                    ],
                },
            },
        });
        await expect(processing).rejects.toThrow(/never reached a handler/);
    });

    it('registers ERC-4626 adapters and reads asset() at their first event', async () => {
        const ADAPTER = '0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5' as const;
        const block = { number: 13_521_369, timestamp: Math.floor(Date.parse('2024-04-23T00:28:05.000Z') / 1000) };
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        {
                            contract: 'Erc4626AdapterFactory',
                            event: 'Erc4626AdapterCreated',
                            srcAddress: BASE_ADAPTER_FACTORY,
                            logIndex: 1,
                            block,
                            transaction: tx(1),
                            params: { proxy: ADAPTER },
                        },
                        {
                            contract: 'Erc4626Adapter',
                            event: 'Transfer',
                            srcAddress: ADAPTER,
                            logIndex: 2,
                            block,
                            transaction: tx(1),
                            params: { from: ZERO, to: USER_A, value: 10n },
                        },
                    ],
                },
            },
        });
        expect(latestById(result, 'Contract').get(`8453-${ADAPTER}`)).toMatchObject({
            kind: 'ERC4626_ADAPTER',
            factory: BASE_ADAPTER_FACTORY,
            factsBlock: BigInt(block.number),
        });
        expect(rowsOf(result, 'ContractLink')).toMatchInlineSnapshot(`
          [
            {
              "fromAddress": "0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5",
              "id": "8453-0xd75ccf9890d8fdfcccc9adf94bebb10d2dcbf5f5-ADAPTER_VAULT-read",
              "logIndex": undefined,
              "relation": "ADAPTER_VAULT",
              "sinceBlock": 13521369n,
              "sinceTimestamp": 2024-04-23T00:28:05.000Z,
              "source": "READ",
              "toAddress": "0xef6ed674486e54507d0f711c0d388bd8a1552e6f",
              "trxHash": undefined,
            },
          ]
        `);
        expect(rowsOf(result, 'BalanceChange')).toHaveLength(1);
    });
});

describe('blacklist', () => {
    it('skips factory registration of blacklisted proxies', async () => {
        const BLACKLISTED_POOL = '0xfb195045365620266ba8c300f42cf69720d2d016' as const;
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        {
                            contract: 'RewardPoolFactory',
                            event: 'RewardPoolCreated',
                            srcAddress: BASE_REWARD_POOL_FACTORY,
                            logIndex: 1,
                            block: { number: 20_000_000, timestamp: TS },
                            transaction: tx(1),
                            params: { proxy: BLACKLISTED_POOL },
                        },
                    ],
                },
            },
        });
        expect(registrationsOf(result)).toEqual([]);
        expect(rowsOf(result, 'Contract')).toEqual([]);
    });

    it('writes no rows for events of a blacklisted address listed in config.yaml', async () => {
        // hyperevm RewardPool listed in config.yaml and in the vault blacklist
        const POOL = '0xb400ea86eb0ded6d313b89ee579fd76cb730922a' as const;
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                999: {
                    simulate: [
                        {
                            contract: 'RewardPool',
                            event: 'Transfer',
                            srcAddress: POOL,
                            logIndex: 1,
                            block: { number: 5_000_000, timestamp: TS },
                            transaction: tx(1),
                            params: { from: ZERO, to: USER_A, value: 10n },
                        },
                    ],
                },
            },
        });
        for (const entity of ['Contract', 'Token', 'ShareTransfer', 'BalanceChange', 'Balance', 'TokenSupply']) {
            expect(rowsOf(result, entity)).toEqual([]);
        }
    });
});
