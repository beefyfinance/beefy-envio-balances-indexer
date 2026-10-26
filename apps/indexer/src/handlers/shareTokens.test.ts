import { createTestIndexer } from 'envio';
import type { Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import { latestById, rowsOf, tx, USER_A, USER_B, USER_C, ZERO } from '../../test/helpers/simulate';

// mooBIFI on Base, configured as a `Token` share token in config.yaml
const MOO_BIFI = '0xc55e93c62874d8100dbd2dfe307edc1036ad5434' as const;
const BLOCK = 17_452_334;
const TS = 1_718_500_600;
// Beefy zap-like holder: raw balances are tracked for every account but 0x0
const ZAP = '0x6f19da51d488926c007b9ebaa5968291a2ec6a63' as const;

const transfer = (logIndex: number, from: Hex, to: Hex, value: bigint, blockOffset = 0) => ({
    contract: 'Token' as const,
    event: 'Transfer' as const,
    srcAddress: MOO_BIFI,
    logIndex,
    block: { number: BLOCK + blockOffset, timestamp: TS + blockOffset * 2 },
    transaction: tx(logIndex),
    params: { from, to, value },
});

describe('share token transfers', () => {
    it('keeps running balances, supply and the balance step function', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        transfer(1, ZERO, USER_A, 100n), // mint
                        transfer(2, USER_A, USER_B, 30n),
                        transfer(3, USER_B, USER_B, 10n, 1), // self-transfer: no balance change
                        transfer(4, USER_A, ZERO, 20n, 1), // burn
                        transfer(5, USER_B, USER_C, 0n, 2), // zero value: no balance change
                        transfer(6, USER_B, ZAP, 5n, 2), // any non-zero account is tracked
                    ],
                },
            },
        });

        const shareTransfers = rowsOf(result, 'ShareTransfer');
        expect(shareTransfers).toHaveLength(6);
        expect(shareTransfers[0]).toEqual({
            id: `8453-${tx(1).hash}-1`,
            token: MOO_BIFI,
            fromAddress: ZERO,
            toAddress: USER_A,
            value: 100n,
            totalSupplyAfter: 100n,
            blockNumber: BigInt(BLOCK),
            blockTimestamp: new Date(TS * 1000),
            trxHash: tx(1).hash,
            trxFrom: tx(1).from,
            logIndex: 1,
        });
        expect(shareTransfers.map((row) => row.totalSupplyAfter)).toEqual([
            100n,
            undefined,
            undefined,
            80n,
            undefined,
            undefined,
        ]);

        const changes = rowsOf<{ id: string; account: string; delta: bigint; balanceAfter: bigint; source: string }>(
            result,
            'BalanceChange'
        );
        expect(changes.map(({ account, delta, balanceAfter }) => [account, delta, balanceAfter])).toEqual([
            [USER_A, 100n, 100n],
            [USER_A, -30n, 70n],
            [USER_B, 30n, 30n],
            [USER_A, -20n, 50n],
            [USER_B, -5n, 25n],
            [ZAP, 5n, 5n],
        ]);
        expect(changes[0]).toMatchObject({ id: `8453-${tx(1).hash}-1-${USER_A}`, token: MOO_BIFI, source: 'TRANSFER' });

        const balances = latestById<{ id: string; balance: bigint }>(result, 'Balance');
        expect([...balances.values()].map(({ id, balance }) => [id, balance])).toEqual([
            [`8453-${MOO_BIFI}-${USER_A}`, 50n],
            [`8453-${MOO_BIFI}-${USER_B}`, 25n],
            [`8453-${MOO_BIFI}-${ZAP}`, 5n],
        ]);
        expect(latestById(result, 'TokenSupply').get(`8453-${MOO_BIFI}`)).toEqual({
            id: `8453-${MOO_BIFI}`,
            token: MOO_BIFI,
            totalSupply: 80n,
            lastChangeBlock: BigInt(BLOCK + 1),
        });
    });

    it('registers the token contract and its on-chain metadata once', async () => {
        const indexer = createTestIndexer();
        const result = await indexer.process({
            chains: { 8453: { simulate: [transfer(1, ZERO, USER_A, 1n), transfer(2, USER_A, USER_B, 1n, 1)] } },
        });

        expect(rowsOf(result, 'Contract')).toEqual([
            {
                id: `8453-${MOO_BIFI}`,
                address: MOO_BIFI,
                kind: 'TOKEN',
                factory: undefined,
                createdBlock: undefined,
                createdTimestamp: undefined,
                createdTrxHash: undefined,
                deployName: undefined,
                factsBlock: BigInt(BLOCK),
                factsStatus: 'OK',
            },
        ]);
        expect(rowsOf(result, 'Token')).toMatchInlineSnapshot(`
          [
            {
              "address": "0xc55e93c62874d8100dbd2dfe307edc1036ad5434",
              "decimals": 18,
              "id": "8453-0xc55e93c62874d8100dbd2dfe307edc1036ad5434",
              "isBeefyShare": true,
              "metadataStatus": "OK",
              "name": "Moo BIFI",
              "symbol": "mooBIFI",
            },
          ]
        `);
        expect(rowsOf(result, 'ContractLink')).toEqual([]);
    });
});
