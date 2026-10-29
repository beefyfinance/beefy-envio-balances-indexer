import type { Contract, EvmOnEventContext, Token } from 'envio';
import { describe, expect, it } from 'vitest';

import { readBoostFacts, readClmManagerFacts, readRewardPoolFacts, readVaultFacts } from '../effects/facts.effects';
import { getTokenMetadata } from '../effects/token.effects';
import { ensureContract, ensureToken, factsRetryBlocks } from './registry';

const VAULT = '0x00000000000000000000000000000000000000aa';
const WANT = '0x00000000000000000000000000000000000000bb';
const BLOCK = 1_000_000;

type Metadata = { status: 'ok' | 'invalid'; decimals?: number; name?: string; symbol?: string };

/**
 * The parts of a handler context the registry uses, in memory. `metadata` answers the token metadata effect (by
 * address, in order: one answer per read), and every effect call is recorded.
 */
const fakeContext = (
    metadata: Record<string, Metadata[]>,
    // per address, in order: one answer per read (the last one repeats); a vault reads WANT by default
    facts: Record<string, Record<string, string | undefined>[]> = {}
) => {
    const tokens = new Map<string, Token>();
    const contracts = new Map<string, Contract>();
    const calls: string[] = [];
    const context = {
        Token: { get: async (id: string) => tokens.get(id), set: (row: Token) => void tokens.set(row.id, row) },
        Contract: {
            get: async (id: string) => contracts.get(id),
            set: (row: Contract) => void contracts.set(row.id, row),
        },
        ContractLink: { set: () => undefined },
        effect: async (effect: unknown, input: { address: string }) => {
            if (effect === getTokenMetadata) {
                calls.push(`metadata ${input.address}`);
                const next = metadata[input.address]?.shift();
                if (next === undefined) throw new Error(`no metadata answer left for ${input.address}`);
                return next;
            }
            if ([readVaultFacts, readBoostFacts, readRewardPoolFacts, readClmManagerFacts].includes(effect as never)) {
                calls.push(`facts ${input.address}`);
                const answers = facts[input.address];
                if (answers === undefined) return { want: WANT };
                return (answers.length > 1 ? answers.shift() : answers[0]) ?? {};
            }
            throw new Error('unexpected effect');
        },
    } as unknown as EvmOnEventContext;
    return { context, tokens, contracts, calls };
};

const ok: Metadata = { status: 'ok', decimals: 6, name: 'USD Coin', symbol: 'USDC' };
const failed: Metadata = { status: 'invalid' };

const event = (block: number, srcAddress: string = VAULT) =>
    ({
        chainId: 42161,
        srcAddress,
        logIndex: 1,
        block: { number: block, timestamp: 1_700_000_000 },
        transaction: { hash: `0x${'1'.repeat(64)}`, from: VAULT },
    }) as unknown as Parameters<typeof ensureContract>[1];

describe('token metadata that could not be read', () => {
    it('is not read again by a per-event caller, so a token that is not an ERC-20 costs nothing per event', async () => {
        const { context, calls } = fakeContext({ [WANT]: [failed] });
        expect(await ensureToken(context, 42161, WANT, false)).toBe(false);
        expect(await ensureToken(context, 42161, WANT, false)).toBe(false);
        expect(calls).toEqual([`metadata ${WANT}`]);
    });

    it('is read again by the facts retry, and then never again once read', async () => {
        const { context, tokens, calls } = fakeContext({ [WANT]: [failed, ok] });
        expect(await ensureToken(context, 42161, WANT, false, true)).toBe(false);
        expect(await ensureToken(context, 42161, WANT, false, true)).toBe(true);
        expect(await ensureToken(context, 42161, WANT, false, true)).toBe(true);
        expect(calls).toEqual([`metadata ${WANT}`, `metadata ${WANT}`]);
        expect(tokens.get(`42161-${WANT}`)).toMatchObject({ decimals: 6, metadataStatus: 'OK' });
    });

    it('keeps the facts PARTIAL until a later retry reads it', async () => {
        const { context, contracts, tokens } = fakeContext({ [VAULT]: [ok, ok], [WANT]: [failed, ok] });
        await ensureContract(context, event(BLOCK), 'VAULT');
        expect(contracts.get(`42161-${VAULT}`)).toMatchObject({ factsStatus: 'PARTIAL' });
        expect(tokens.get(`42161-${WANT}`)).toMatchObject({ metadataStatus: 'INVALID' });

        // too soon: no read
        await ensureContract(context, event(BLOCK + 1), 'VAULT');
        expect(tokens.get(`42161-${WANT}`)).toMatchObject({ metadataStatus: 'INVALID' });

        await ensureContract(context, event(BLOCK + Number(factsRetryBlocks())), 'VAULT');
        expect(contracts.get(`42161-${VAULT}`)).toMatchObject({ factsStatus: 'OK' });
        expect(tokens.get(`42161-${WANT}`)).toMatchObject({ metadataStatus: 'OK', decimals: 6 });
    });
});

describe('price facts', () => {
    const CLM = '0x00000000000000000000000000000000000000cc';
    const BOOST = '0x00000000000000000000000000000000000000dd';
    const POOL = '0x00000000000000000000000000000000000000ee';
    const REWARD = '0x00000000000000000000000000000000000000ff';
    const usdc: Metadata = { status: 'ok', decimals: 6, name: 'USD Coin', symbol: 'USDC' };
    const share: Metadata = { status: 'ok', decimals: 18, name: 'Share', symbol: 'SHARE' };
    const priceFacts = (contracts: Map<string, Contract>, address: string) => {
        const { productAddress, priceDecimals, productKind } = contracts.get(`42161-${address}`) ?? {};
        return { productAddress, priceDecimals, productKind };
    };

    it('prices a classic vault per its want decimals', async () => {
        const { context, contracts } = fakeContext({ [VAULT]: [share], [WANT]: [usdc] });
        await ensureContract(context, event(BLOCK), 'VAULT');
        expect(priceFacts(contracts, VAULT)).toEqual({ productAddress: VAULT, priceDecimals: 6, productKind: 'VAULT' });
    });

    it('prices a CLM per its own share decimals', async () => {
        const { context, contracts } = fakeContext(
            { [CLM]: [share], [WANT]: [usdc], [REWARD]: [usdc] },
            { [CLM]: [{ want0: WANT, want1: REWARD }] }
        );
        await ensureContract(context, event(BLOCK, CLM), 'CLM_MANAGER');
        expect(priceFacts(contracts, CLM)).toEqual({
            productAddress: CLM,
            priceDecimals: 18,
            productKind: 'CLM_MANAGER',
        });
    });

    it('prices a boost per the vault it stakes, a reward pool per the CLM it stakes', async () => {
        const { context, contracts } = fakeContext(
            { [VAULT]: [share], [WANT]: [usdc], [CLM]: [share], [BOOST]: [failed], [POOL]: [share], [REWARD]: [usdc] },
            {
                [CLM]: [{ want0: WANT, want1: REWARD }],
                [BOOST]: [{ stakedToken: VAULT, rewardToken: REWARD }],
                [POOL]: [{ stakedToken: CLM }],
            }
        );
        await ensureContract(context, event(BLOCK), 'VAULT');
        await ensureContract(context, event(BLOCK, CLM), 'CLM_MANAGER');
        await ensureContract(context, event(BLOCK, BOOST), 'BOOST');
        await ensureContract(context, event(BLOCK, POOL), 'REWARD_POOL');
        expect(priceFacts(contracts, BOOST)).toEqual({ productAddress: VAULT, priceDecimals: 6, productKind: 'VAULT' });
        expect(priceFacts(contracts, POOL)).toEqual({
            productAddress: CLM,
            priceDecimals: 18,
            productKind: 'CLM_MANAGER',
        });
    });

    it('completes a boost once the vault it stakes is registered', async () => {
        const { context, contracts } = fakeContext(
            // the vault's token is read as the staked token, then again as a share when the vault registers
            { [VAULT]: [share, share], [WANT]: [usdc], [BOOST]: [failed], [REWARD]: [usdc] },
            { [BOOST]: [{ stakedToken: VAULT, rewardToken: REWARD }] }
        );
        await ensureContract(context, event(BLOCK, BOOST), 'BOOST');
        expect(priceFacts(contracts, BOOST)).toEqual({
            productAddress: VAULT,
            priceDecimals: undefined,
            productKind: undefined,
        });

        await ensureContract(context, event(BLOCK), 'VAULT');
        await ensureContract(context, event(BLOCK + 1, BOOST), 'BOOST');
        expect(priceFacts(contracts, BOOST)).toEqual({ productAddress: VAULT, priceDecimals: 6, productKind: 'VAULT' });
    });

    it('leaves a vault unpriced until its want is read, and its boost until then', async () => {
        const { context, contracts } = fakeContext(
            { [VAULT]: [share, share], [WANT]: [usdc], [BOOST]: [failed], [REWARD]: [usdc] },
            {
                // want() reverts at the first read, answers at the retry
                [VAULT]: [{ want: undefined }, { want: WANT }],
                [BOOST]: [{ stakedToken: VAULT, rewardToken: REWARD }],
            }
        );
        await ensureContract(context, event(BLOCK), 'VAULT');
        await ensureContract(context, event(BLOCK, BOOST), 'BOOST');
        expect(priceFacts(contracts, VAULT)).toEqual({
            productAddress: VAULT,
            priceDecimals: undefined,
            productKind: undefined,
        });
        expect(priceFacts(contracts, BOOST)).toMatchObject({ priceDecimals: undefined });

        await ensureContract(context, event(BLOCK + Number(factsRetryBlocks())), 'VAULT');
        await ensureContract(context, event(BLOCK + Number(factsRetryBlocks()), BOOST), 'BOOST');
        expect(priceFacts(contracts, VAULT)).toEqual({ productAddress: VAULT, priceDecimals: 6, productKind: 'VAULT' });
        expect(priceFacts(contracts, BOOST)).toEqual({ productAddress: VAULT, priceDecimals: 6, productKind: 'VAULT' });
    });
});
