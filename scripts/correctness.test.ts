import { encodeAbiParameters, type Hex, pad } from 'viem';
import { describe, expect, it } from 'vitest';
import {
    blockRanges,
    type ChainLog,
    classifyLog,
    countMismatches,
    diffKeys,
    EVENT_TABLES,
    eventKey,
    expectedRowFields,
    fieldMismatches,
    formatResult,
    handledEventTopics,
    hasOnChainValue,
    parseArgs,
    parseChainConfig,
    parseCsv,
    result,
    sampleSizes,
    TOPICS,
} from './correctness';

const address = (tag: number) => `0x${tag.toString(16).padStart(40, '0')}`;
const TOKEN = address(1);
const BOOST = address(2);
const MANAGER = address(3);
const ALICE = address(10);
const BOB = address(11);
const HASH = `0x${'ab'.repeat(32)}`;

describe('parseArgs', () => {
    const env = { ENVIO_RPC_URL_4326: 'https://rpc.example/4326', ENVIO_PG_SCHEMA: 'envschema' };

    it('applies defaults from the environment', () => {
        expect(parseArgs(['--chain', '4326'], env)).toEqual({
            chainId: 4326,
            block: undefined,
            schema: 'envschema',
            rpc: 'https://rpc.example/4326',
            only: ['supply', 'balances', 'events', 'fields', 'clm-pool-state', 'coverage'],
            sample: 100,
            concurrency: 3,
            config: 'config.local.yaml',
        });
    });

    it('reads every flag', () => {
        const args = parseArgs(
            [
                ...['--chain', '4326', '--block', '123', '--schema', 'raw_megaeth', '--rpc', 'https://other'],
                ...['--only', 'supply, events', '--sample', '20', '--concurrency', '2'],
            ],
            env
        );
        expect(args).toMatchObject({
            block: 123n,
            schema: 'raw_megaeth',
            rpc: 'https://other',
            only: ['supply', 'events'],
            sample: 20,
            concurrency: 2,
        });
    });

    it('rejects bad input', () => {
        expect(() => parseArgs([], env)).toThrow('--chain');
        expect(() => parseArgs(['--chain', '1'], env)).toThrow('ENVIO_RPC_URL_1');
        expect(() => parseArgs(['--chain', '4326', '--schema', 'a"; drop'], env)).toThrow('--schema');
        expect(() => parseArgs(['--chain', '4326', '--only', 'nope'], env)).toThrow('nope');
        expect(() => parseArgs(['--chain', '4326', '--bogus', '1'], env)).toThrow('--bogus');
        expect(() => parseArgs(['--chain', '4326', '--block'], env)).toThrow('--block');
    });
});

describe('parseCsv', () => {
    it('parses quoted fields, NULLs and empty strings', () => {
        const csv = 'a,b,c\n1,,""\n"x,y","he said ""hi""","multi\nline"\n';
        expect(parseCsv(csv)).toEqual([
            { a: '1', b: null, c: '' },
            { a: 'x,y', b: 'he said "hi"', c: 'multi\nline' },
        ]);
    });

    it('handles CRLF, a missing final newline and empty output', () => {
        expect(parseCsv('n\r\n5\r\n6')).toEqual([{ n: '5' }, { n: '6' }]);
        expect(parseCsv('')).toEqual([]);
        expect(parseCsv('only_header\n')).toEqual([]);
    });
});

describe('parseChainConfig', () => {
    const yaml = [
        'contracts:',
        '  - name: ClassicVault',
        'chains:',
        '  - id: 1 # mainnet',
        '    start_block: 10',
        '    contracts:',
        '      - name: ClassicVault',
        '        address:',
        '          - 0x00000000000000000000000000000000000000AA',
        '  - id: 4326 # megaeth',
        '    start_block: 7854030',
        '    rpc:',
        '      - url: https://rpc.example',
        '        for: sync',
        '    contracts:',
        '      - name: ClassicVaultFactory',
        '        address:',
        '          - 0xecf7d9a1f6bc964e67806e7B9F1830B9a0328018',
        '      - name: ClassicBoost',
        '        address: []',
        '      - name: ClmManager',
        '        address:',
        '          # generated: known contracts (scripts/knownContracts.ts), do not edit until the end marker',
        '          - 0x3808e89223f26ddbacbf3cf36f99e37e537fb3de',
        '          # end generated',
        '      - name: BeefySwapper',
        '        address: 0xEa13A590eFd8545a10134d08081d6fC2FA0417a7',
        'unordered_multichain_mode: true',
        '      - name: Ignored',
        '        address:',
        '          - 0x00000000000000000000000000000000000000BB',
    ].join('\n');

    it('reads the start block and the static addresses of one chain', () => {
        expect(parseChainConfig(yaml, 4326)).toEqual({
            startBlock: 7854030n,
            contracts: [
                { name: 'ClassicVaultFactory', address: '0xecf7d9a1f6bc964e67806e7b9f1830b9a0328018' },
                { name: 'ClmManager', address: '0x3808e89223f26ddbacbf3cf36f99e37e537fb3de' },
                { name: 'BeefySwapper', address: '0xea13a590efd8545a10134d08081d6fc2fa0417a7' },
            ],
        });
        expect(parseChainConfig(yaml, 1)?.contracts).toHaveLength(1);
        expect(parseChainConfig(yaml, 56)).toBeUndefined();
    });

    it('collects the handled event topics', () => {
        const topics = handledEventTopics(
            [
                '      - event: "Transfer(address indexed from, address indexed to, uint256 value)"',
                '      - event: "Transfer(address indexed from, address indexed to, uint256 value)"',
                '      - event: "Staked(address indexed user, uint256 amount)"',
            ].join('\n')
        );
        expect(topics).toEqual([TOPICS.transfer, TOPICS.staked]);
    });
});

describe('blockRanges', () => {
    it('covers the interval inclusively', () => {
        expect(blockRanges(0n, 250n, 100n)).toEqual([
            { from: 0n, to: 99n },
            { from: 100n, to: 199n },
            { from: 200n, to: 250n },
        ]);
        expect(blockRanges(5n, 5n, 100n)).toEqual([{ from: 5n, to: 5n }]);
        expect(blockRanges(6n, 5n, 100n)).toEqual([]);
    });
});

describe('event comparison', () => {
    it('keys events by lowercase hash and numeric log index', () => {
        expect(eventKey('0xABC', '7')).toBe('0xabc-7');
    });

    it('diffs key sets', () => {
        expect(diffKeys(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toEqual({
            missing: ['a'],
            extra: ['d'],
            matched: ['b', 'c'],
        });
    });

    it('compares fields as normalized text', () => {
        expect(
            fieldMismatches({ value: 10n, to_address: '0xAA', n: 3 }, { value: '10', to_address: '0xaa', n: '3' })
        ).toEqual([]);
        expect(fieldMismatches({ value: 10n, trx_from: '0x1' }, { value: '11', trx_from: null })).toEqual([
            'value: chain 10 != db 11',
            'trx_from: chain 0x1 != db null',
        ]);
    });

    it('reports per-emitter count differences', () => {
        expect(countMismatches(['a', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['a: chain 2 != db 1', 'c: chain 0 != db 1']);
    });

    const sets = {
        transferTokens: new Set([TOKEN, MANAGER]),
        boosts: new Set([BOOST]),
        managers: new Set([MANAGER]),
    };
    const topicOf = (account: string) => pad(account as Hex).toLowerCase();

    it('classifies logs by emitter and topic0', () => {
        expect(classifyLog({ address: TOKEN, topics: [TOPICS.transfer, topicOf(ALICE), topicOf(BOB)] }, sets)).toBe(
            'ShareTransfer'
        );
        // ERC-721 style transfer (4 topics) and transfers of unknown tokens are not share transfers
        expect(
            classifyLog({ address: TOKEN, topics: [TOPICS.transfer, topicOf(ALICE), topicOf(BOB), topicOf(BOB)] }, sets)
        ).toBeUndefined();
        expect(classifyLog({ address: BOOST, topics: [TOPICS.transfer, topicOf(ALICE), topicOf(BOB)] }, sets)).toBe(
            undefined
        );
        expect(classifyLog({ address: BOOST.toUpperCase().replace('0X', '0x'), topics: [TOPICS.staked] }, sets)).toBe(
            'BoostStake'
        );
        expect(classifyLog({ address: MANAGER, topics: [TOPICS.clmDeposit] }, sets)).toBe('ClmDeposit');
        expect(classifyLog({ address: MANAGER, topics: [TOPICS.clmWithdraw] }, sets)).toBe('ClmWithdraw');
        expect(classifyLog({ address: TOKEN, topics: [TOPICS.clmDeposit] }, sets)).toBeUndefined();
    });

    const log = (overrides: Partial<ChainLog>): ChainLog => ({
        address: TOKEN,
        topics: [],
        data: '0x',
        blockNumber: 42n,
        transactionHash: HASH,
        logIndex: 3,
        ...overrides,
    });

    it('decodes the expected row fields', () => {
        const transfer = log({
            topics: [TOPICS.transfer, topicOf(ALICE), topicOf(BOB)],
            data: encodeAbiParameters([{ type: 'uint256' }], [5n]),
        });
        const expected = expectedRowFields('ShareTransfer', transfer);
        expect(
            fieldMismatches(expected, {
                emitter: TOKEN,
                block_number: '42',
                from_address: ALICE,
                to_address: BOB,
                value: '5',
            })
        ).toEqual([]);

        const withdrawn = log({
            address: BOOST,
            topics: [TOPICS.withdrawn, topicOf(ALICE)],
            data: encodeAbiParameters([{ type: 'uint256' }], [7n]),
        });
        expect(expectedRowFields('BoostStake', withdrawn)).toMatchObject({ amount: 7n, direction: 'UNSTAKE' });

        const deposit = log({
            address: MANAGER,
            topics: [TOPICS.clmDeposit, topicOf(ALICE)],
            data: encodeAbiParameters(
                [
                    { type: 'uint256' },
                    { type: 'uint256' },
                    { type: 'uint256' },
                    { type: 'uint256' },
                    { type: 'uint256' },
                ],
                [1n, 2n, 3n, 4n, 5n]
            ),
        });
        expect(expectedRowFields('ClmDeposit', deposit)).toMatchObject({
            shares: 1n,
            amount0: 2n,
            amount1: 3n,
            fee0: 4n,
            fee1: 5n,
        });
    });
});

describe('sampling and output', () => {
    it('splits the sample evenly over non-empty tables', () => {
        expect(sampleSizes({ A: 1000, B: 3, C: 0, D: 50 }, 100)).toEqual({ A: 34, B: 3, D: 34 });
        expect(sampleSizes({ A: 0 }, 100)).toEqual({});
    });

    it('declares the expected events of every event table', () => {
        expect(EVENT_TABLES.ShareTransfer?.topics).toEqual([TOPICS.transfer]);
        expect(EVENT_TABLES.Harvest?.topics).toHaveLength(5);
    });

    it('fails a check with mismatches and truncates the list', () => {
        const failing = result(
            'x',
            ['detail'],
            Array.from({ length: 12 }, (_, index) => `m${index}`)
        );
        expect(failing.status).toBe('FAIL');
        const text = formatResult(failing);
        expect(text).toContain('[FAIL] x');
        expect(text).toContain('12 mismatch(es)');
        expect(text).toContain('m9');
        expect(text).not.toContain('m10');
        expect(text).toContain('... 2 more');
        expect(formatResult(result('y', [], []))).toBe('[PASS] y');
    });

    it('treats empty strings, zero addresses and failed reads as nothing on chain', () => {
        expect(hasOnChainValue({ ok: false })).toBe(false);
        expect(hasOnChainValue({ ok: true, value: '' })).toBe(false);
        expect(hasOnChainValue({ ok: true, value: '0x0000000000000000000000000000000000000000' })).toBe(false);
        expect(
            hasOnChainValue({
                ok: true,
                value: ['0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000'],
            })
        ).toBe(false);
        expect(hasOnChainValue({ ok: true, value: 'mooToken' })).toBe(true);
        expect(
            hasOnChainValue({
                ok: true,
                value: ['0x0000000000000000000000000000000000000000', '0x4200000000000000000000000000000000000006'],
            })
        ).toBe(true);
    });
});
