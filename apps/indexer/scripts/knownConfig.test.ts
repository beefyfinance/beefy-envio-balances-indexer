import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractKnownContracts, generatedMarkers, knownAddresses, mergeKnownContracts } from './knownConfig.ts';

const { begin: BEGIN_MARKER, end: END_MARKER } = generatedMarkers();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** `${ENVIO_RPC_URL_<id>}` as written in config.yaml */
const rpcUrl = (chainId: number) => `\${ENVIO_RPC_URL_${chainId}}`;

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

    it('refuses to write anything but a lowercase address into the YAML', () => {
        const hostile = new Map([
            [8453, new Map([['ClassicVault', ['0x1111111111111111111111111111111111111111\n  - id: 1']]])],
        ]);
        expect(() => mergeKnownContracts(config, hostile)).toThrow('not a lowercase address');
    });

    it('routes strategies to the StratHarvest ABI variant', () => {
        const strategies = knownAddresses([
            { chainId: 56, address: '0x5555555555555555555555555555555555555555', kind: 'STRATEGY' },
        ]);
        expect([...(strategies.get(56)?.keys() ?? [])]).toEqual(['ClassicStrategy', 'ClassicStrategyStratHarvest0']);
    });
});

describe('config.yaml', () => {
    it("config.yaml's generated blocks are sorted, unique and not hand-listed (as knownContracts.ts writes them)", () => {
        const config = readFileSync(join(root, 'config.yaml'), 'utf8');
        expect(mergeKnownContracts(config, extractKnownContracts(config))).toBe(config);
    });
});
