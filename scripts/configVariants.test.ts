import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from 'remeda';
import { describe, expect, it } from 'vitest';
import {
    BEGIN_MARKER,
    END_MARKER,
    extractKnownContracts,
    generateAll,
    knownAddresses,
    mergeKnownContracts,
    toLocalConfig,
    toLocalSchema,
    toRpcConfig,
} from './configVariants';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** `${ENVIO_RPC_URL_<id>}` as written in config.yaml */
const rpcUrl = (chainId: number) => `$${'{'}ENVIO_RPC_URL_${chainId}}`;

const config = [
    '# yaml-language-server: $schema=./node_modules/envio/evm.schema.json',
    'name: x',
    'storage:',
    '  postgres:',
    '    default: false',
    '  clickhouse:',
    '    default: true',
    'contracts: []',
    'chains:',
    '  - id: 8453 # base',
    '    start_block: 1',
    '    rpc:',
    `      - url: ${rpcUrl(8453)}`,
    '    contracts:',
    '      - name: ClassicVault',
    '        address:',
    '          - 0x1111111111111111111111111111111111111111 # hand',
    '      - name: ClmManager',
    '        address: []',
    '  - id: 999',
    '    start_block: 2',
    '    rpc:',
    `      - url: ${rpcUrl(999)}`,
    '        for: sync',
    '        interval_ceiling: 250',
    '    contracts:',
    '      - name: ClassicVault',
    '        address: []',
    '',
].join('\n');

const known = knownAddresses([
    { chainId: 8453, address: '0x1111111111111111111111111111111111111111', kind: 'VAULT' },
    { chainId: 8453, address: '0x2222222222222222222222222222222222222222', kind: 'VAULT' },
    { chainId: 8453, address: '0x3333333333333333333333333333333333333333', kind: 'CLM_MANAGER' },
    // listed twice: one entry
    { chainId: 8453, address: '0x3333333333333333333333333333333333333333', kind: 'CLM_MANAGER' },
]);

describe('known contracts merge', () => {
    it('appends known addresses after the hand-listed ones, between markers, without duplicates', () => {
        const merged = mergeKnownContracts(config, known);
        expect(merged).toContain(
            [
                '      - name: ClassicVault',
                '        address:',
                '          - 0x1111111111111111111111111111111111111111 # hand',
                `          ${BEGIN_MARKER}`,
                '          - 0x2222222222222222222222222222222222222222',
                `          ${END_MARKER}`,
                '      - name: ClmManager',
                '        address:',
                `          ${BEGIN_MARKER}`,
                '          - 0x3333333333333333333333333333333333333333',
                `          ${END_MARKER}`,
            ].join('\n')
        );
        // other chains untouched
        expect(merged).toContain('  - id: 999\n');
        // the generated blocks read back as the same known contracts
        expect(extractKnownContracts(merged)).toEqual(
            new Map([
                [
                    8453,
                    new Map([
                        ['ClassicVault', ['0x2222222222222222222222222222222222222222']],
                        ['ClmManager', ['0x3333333333333333333333333333333333333333']],
                    ]),
                ],
            ])
        );
        expect(mergeKnownContracts(merged, known)).toBe(merged);
        // dropping the known contracts restores the hand-written lists
        expect(mergeKnownContracts(merged, new Map())).toBe(config);
    });

    it('routes strategies to the StratHarvest ABI variant', () => {
        const strategies = knownAddresses([
            { chainId: 56, address: '0x5555555555555555555555555555555555555555', kind: 'STRATEGY' },
        ]);
        expect([...(strategies.get(56)?.keys() ?? [])]).toEqual(['ClassicStrategy', 'ClassicStrategyStratHarvest0']);
    });
});

describe('config variants', () => {
    it('RPC variant: every chain syncs over RPC, storage unchanged', () => {
        const rpc = toRpcConfig(config);
        expect(rpc.split('\n')[0]).toMatch(/^# yaml-language-server/);
        expect(rpc.match(/^ {8}for: sync$/gm)).toHaveLength(2);
        expect(rpc).toContain(`      - url: ${rpcUrl(8453)}\n        for: sync\n`);
        expect(rpc).toContain(`      - url: ${rpcUrl(999)}\n        for: sync\n        interval_ceiling: 250\n`);
        expect(rpc).toContain('  clickhouse:');
        expect(() => toRpcConfig(config.replace(`      - url: ${rpcUrl(8453)}\n`, ''))).toThrow(
            'every chain needs an rpc url'
        );
    });

    it('local variant: RPC sync, Postgres only, local schema', () => {
        const local = toLocalConfig(config);
        expect(local).toContain('schema: schema.local.graphql');
        expect(local).toContain('  postgres:\n    default: true');
        expect(local).not.toContain('clickhouse');
        expect(local.match(/^ {8}for: sync$/gm)).toHaveLength(2);
    });

    it('strips every storage directive, nested parentheses included', () => {
        const schema = [
            'type A @storage(postgres: true, clickhouse: true) {',
            '  id: ID!',
            '}',
            'type B',
            '  @index(fields: ["x"])',
            '  @storage(',
            '    clickhouse: { orderBy: ["chainId", "x"], ttl: "toDate(t) + INTERVAL 1 YEAR" }',
            '  ) {',
            '  id: ID!',
            '}',
        ].join('\n');
        const local = toLocalSchema(schema);
        expect(local).not.toContain('@storage');
        expect(local).toContain('type A {');
        expect(local).toContain('  @index(fields: ["x"]) {');
        expect(() => toLocalSchema('type A @storage(postgres: true {')).toThrow('Unbalanced');
    });

    it('committed variants are up to date (run `pnpm config:generate`)', () => {
        R.pipe(
            generateAll(root),
            R.entries(),
            R.forEach(([file, content]) => {
                expect(readFileSync(join(root, file), 'utf8'), file).toBe(content);
            })
        );
    });

    it("config.yaml's generated blocks are sorted, unique and not hand-listed (as knownContracts.ts writes them)", () => {
        const config = readFileSync(join(root, 'config.yaml'), 'utf8');
        expect(mergeKnownContracts(config, extractKnownContracts(config))).toBe(config);
    });
});
