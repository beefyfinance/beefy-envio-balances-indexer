import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

import { latestById, registrationsOf, rowsOf, tx, USER_A, ZERO } from '../../test/helpers/simulate';

// BSC vault listed in config.yaml, and the strategy it pointed to in October 2021
const VAULT = '0xba53af4c2f1649f82e8070fb306ddbf2771a1950' as const;
const STRATEGY = '0xe807517273de0161d8309bc9363193f2162b9b65' as const;
// an upgrade target that is not a known (static) strategy, so UpgradeStrat registers it
const NEW_STRATEGY = '0x00000000000000000000000000000000005714a7' as const;
// legacy vault with a broken want(): facts come from src/config/classic/staticVaults.ts
const STATIC_VAULT = '0x6be4741ab0ad233e4315a10bc783a7b923386b71' as const;
const BLOCK = 12_132_390;
const TS = Math.floor(Date.parse('2021-10-27T09:56:05.000Z') / 1000);
const at = (offset: number) => ({ number: BLOCK + offset, timestamp: TS + offset * 3 });

describe('classic vault', () => {
    it('reads vault facts once, writes share transfers and appends strategy upgrades', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                56: {
                    simulate: [
                        {
                            contract: 'ClassicVault',
                            event: 'Initialized',
                            srcAddress: VAULT,
                            logIndex: 1,
                            block: at(0),
                            transaction: tx(1),
                            params: { version: 1n },
                        },
                        {
                            contract: 'ClassicVault',
                            event: 'Transfer',
                            srcAddress: VAULT,
                            logIndex: 2,
                            block: at(0),
                            transaction: tx(2, USER_A),
                            params: { from: ZERO, to: USER_A, value: 1_000n },
                        },
                        {
                            contract: 'ClassicVault',
                            event: 'UpgradeStrat',
                            srcAddress: VAULT,
                            logIndex: 1,
                            block: at(1),
                            transaction: tx(3),
                            params: { implementation: NEW_STRATEGY },
                        },
                    ],
                },
            },
        });

        expect(rowsOf(result, 'Contract')).toEqual([
            expect.objectContaining({ id: `56-${VAULT}`, kind: 'VAULT', factsBlock: BigInt(BLOCK), factsStatus: 'OK' }),
        ]);
        expect(rowsOf(result, 'ContractLink')).toMatchInlineSnapshot(`
          [
            {
              "fromAddress": "0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
              "id": "56-0xba53af4c2f1649f82e8070fb306ddbf2771a1950-VAULT_WANT-read",
              "logIndex": undefined,
              "relation": "VAULT_WANT",
              "sinceBlock": 12132390n,
              "sinceTimestamp": 2021-10-27T09:56:05.000Z,
              "source": "READ",
              "toAddress": "0x111111111117dc0aa78b770fa6a738034120c302",
              "trxHash": undefined,
            },
            {
              "fromAddress": "0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
              "id": "56-0x0000000000000000000000000000000000000000000000000000000000000003-1-VAULT_STRATEGY",
              "logIndex": 1,
              "relation": "VAULT_STRATEGY",
              "sinceBlock": 12132391n,
              "sinceTimestamp": 2021-10-27T09:56:08.000Z,
              "source": "EVENT",
              "toAddress": "0x00000000000000000000000000000000005714a7",
              "trxHash": "0x0000000000000000000000000000000000000000000000000000000000000003",
            },
          ]
        `);
        expect(rowsOf(result, 'Token')).toMatchInlineSnapshot(`
          [
            {
              "address": "0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
              "decimals": 18,
              "id": "56-0xba53af4c2f1649f82e8070fb306ddbf2771a1950",
              "isBeefyShare": true,
              "metadataStatus": "OK",
              "name": "Moo 1INCH 1INCH",
              "symbol": "moo1INCH1INCH",
            },
            {
              "address": "0x111111111117dc0aa78b770fa6a738034120c302",
              "decimals": 18,
              "id": "56-0x111111111117dc0aa78b770fa6a738034120c302",
              "isBeefyShare": false,
              "metadataStatus": "OK",
              "name": "1INCH Token",
              "symbol": "1INCH",
            },
          ]
        `);
        expect(rowsOf(result, 'ShareTransfer')).toHaveLength(1);
        expect(latestById(result, 'Balance').get(`56-${VAULT}-${USER_A}`)).toMatchObject({ balance: 1_000n });
        // UpgradeStrat registers the new strategy for the strategy events (StratHarvest ABI variant 0)
        expect(registrationsOf(result)).toEqual([
            { address: NEW_STRATEGY, contract: 'ClassicStrategy' },
            { address: NEW_STRATEGY, contract: 'ClassicStrategyStratHarvest0' },
        ]);
    });

    it('uses static facts for legacy vaults without an eth_call', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                56: {
                    simulate: [
                        {
                            contract: 'ClassicVault',
                            event: 'Transfer',
                            srcAddress: STATIC_VAULT,
                            logIndex: 1,
                            block: at(0),
                            transaction: tx(1),
                            params: { from: ZERO, to: USER_A, value: 5n },
                        },
                    ],
                },
            },
        });
        expect(
            rowsOf<{ relation: string; toAddress: string }>(result, 'ContractLink').map(({ relation, toAddress }) => [
                relation,
                toAddress,
            ])
        ).toEqual([['VAULT_WANT', '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c']]);
    });
});

describe('classic strategy', () => {
    const registerStrategy = {
        contract: 'ClassicVault' as const,
        event: 'UpgradeStrat' as const,
        srcAddress: VAULT,
        logIndex: 1,
        block: at(0),
        transaction: tx(1),
        params: { implementation: STRATEGY },
    };

    it('writes harvests, fees and pause changes as raw rows', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                56: {
                    simulate: [
                        registerStrategy,
                        {
                            contract: 'ClassicStrategyStratHarvest0',
                            event: 'StratHarvest',
                            srcAddress: STRATEGY,
                            logIndex: 1,
                            block: at(1),
                            transaction: tx(2, USER_A),
                            params: { harvester: USER_A, wantHarvested: 123n, tvl: 4_560n },
                        },
                        {
                            contract: 'ClassicStrategy',
                            event: 'ChargedFeesV2',
                            srcAddress: STRATEGY,
                            logIndex: 2,
                            block: at(1),
                            transaction: tx(2, USER_A),
                            params: { callFees: 1n, beefyFees: 2n, strategistFees: 3n },
                        },
                        {
                            contract: 'ClassicStrategy',
                            event: 'ChargedFees',
                            srcAddress: STRATEGY,
                            logIndex: 3,
                            block: at(1),
                            transaction: tx(2, USER_A),
                            params: { beefyFee: 7n, liquidityFee: 8n },
                        },
                        {
                            contract: 'ClassicStrategy',
                            event: 'Paused',
                            srcAddress: STRATEGY,
                            logIndex: 1,
                            block: at(2),
                            transaction: tx(3),
                            params: { account: USER_A },
                        },
                    ],
                },
            },
        });

        expect(rowsOf(result, 'Harvest')).toEqual([
            {
                id: `56-${tx(2).hash}-1`,
                strategy: STRATEGY,
                kind: 'CLASSIC_STRAT_HARVEST',
                harvester: USER_A,
                wantHarvested: 123n,
                tvl: 4_560n,
                fee0: undefined,
                fee1: undefined,
                fees: undefined,
                feeMain0: undefined,
                feeMain1: undefined,
                feeAlt0: undefined,
                feeAlt1: undefined,
                blockNumber: BigInt(BLOCK + 1),
                blockTimestamp: new Date((TS + 3) * 1000),
                trxHash: tx(2).hash,
                trxFrom: USER_A,
                logIndex: 1,
            },
        ]);
        expect(
            rowsOf(result, 'FeesCharged').map(
                ({ version, callFee, beefyFee, strategistFee, liquidityFee, family }) => ({
                    family,
                    version,
                    callFee,
                    beefyFee,
                    strategistFee,
                    liquidityFee,
                })
            )
        ).toEqual([
            { family: 'CLASSIC', version: 2, callFee: 1n, beefyFee: 2n, strategistFee: 3n, liquidityFee: undefined },
            {
                family: 'CLASSIC',
                version: 1,
                callFee: undefined,
                beefyFee: 7n,
                strategistFee: undefined,
                liquidityFee: 8n,
            },
        ]);
        expect(rowsOf(result, 'PauseChange')).toEqual([
            expect.objectContaining({ contract: STRATEGY, paused: true, account: USER_A, logIndex: 1 }),
        ]);
        // strategy facts: vault() read at the strategy's first event
        expect(rowsOf(result, 'ContractLink').filter((link) => link.relation === 'STRATEGY_VAULT')).toEqual([
            expect.objectContaining({
                fromAddress: STRATEGY,
                toAddress: VAULT,
                source: 'READ',
                sinceBlock: BigInt(BLOCK + 1),
            }),
        ]);
    });
});
