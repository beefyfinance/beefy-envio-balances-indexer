import type { PublicClient } from 'viem';
import { describe, expect, it } from 'vitest';
import { toBytes, toHex } from '../../hex';
import type { TokenBalance } from './common';
import { getVaultTokenBreakdownBeefyClm, getVaultTokenBreakdownBeefyClmVault, isBeefyClmVault } from './index';

const VAULT = toBytes('0xe93760be0be03a87cca941dd288a4f493e22beda');
const CLM = toBytes('0xb84d080b1e35f74dc512f06522341145be5a5d40');
const TOKEN0 = '0x4200000000000000000000000000000000000006' as const;
const TOKEN1 = '0x940181a94a35a4569e4529a3cdfb74e38fd98631' as const;

const revert = { status: 'failure' as const, error: new Error('execution reverted') };
const mockClient = (results: unknown[]) => ({ multicall: async () => results }) as unknown as PublicClient;
const snapshot = (breakdown: TokenBalance[]) => breakdown.map((entry) => [toHex(entry.tokenAddress), entry.rawBalance]);

describe('Beefy CLM classic vault platform', () => {
    it('identifies a CLM-wrapped vault from wants() even when balances() reverts', async () => {
        const client = mockClient([{ status: 'success', result: [TOKEN0, TOKEN1] }]);
        await expect(isBeefyClmVault({ client, underlyingTokenAddress: CLM })).resolves.toBe(true);
    });

    it('does not identify a CLM-wrapped vault when wants() reverts', async () => {
        await expect(isBeefyClmVault({ client: mockClient([revert]), underlyingTokenAddress: CLM })).resolves.toBe(
            false
        );
    });

    it('keeps want tokens and uses zero amounts when empty-vault calls revert', async () => {
        const client = mockClient([
            revert,
            { status: 'success', result: 0n },
            { status: 'success', result: [TOKEN0, TOKEN1] },
            revert,
        ]);

        expect(
            snapshot(
                await getVaultTokenBreakdownBeefyClmVault({
                    client,
                    vaultAddress: VAULT,
                    underlyingTokenAddress: CLM,
                })
            )
        ).toEqual([
            [TOKEN0, 0n],
            [TOKEN1, 0n],
        ]);
    });

    it('scales CLM balances by vault share when supply is non-zero', async () => {
        const client = mockClient([
            { status: 'success', result: 50n },
            { status: 'success', result: 100n },
            { status: 'success', result: [TOKEN0, TOKEN1] },
            { status: 'success', result: [10n, 20n] },
        ]);

        expect(
            snapshot(
                await getVaultTokenBreakdownBeefyClmVault({
                    client,
                    vaultAddress: VAULT,
                    underlyingTokenAddress: CLM,
                })
            )
        ).toEqual([
            [TOKEN0, 5n],
            [TOKEN1, 10n],
        ]);
    });

    it('returns empty breakdown when the underlying is not a CLM', async () => {
        const client = mockClient([
            { status: 'success', result: 0n },
            { status: 'success', result: 0n },
            revert,
            revert,
        ]);

        await expect(
            getVaultTokenBreakdownBeefyClmVault({
                client,
                vaultAddress: VAULT,
                underlyingTokenAddress: CLM,
            })
        ).resolves.toEqual([]);
    });

    it('keeps want tokens when a CLM manager balances() reverts', async () => {
        const client = mockClient([{ status: 'success', result: [TOKEN0, TOKEN1] }, revert]);
        expect(snapshot(await getVaultTokenBreakdownBeefyClm({ client, vaultAddress: CLM }))).toEqual([
            [TOKEN0, 0n],
            [TOKEN1, 0n],
        ]);
    });
});
