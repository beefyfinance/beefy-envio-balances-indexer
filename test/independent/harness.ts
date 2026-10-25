/**
 * Independent-test harness: simulate-item builders for real Base data, and an RPC request counter.
 */
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { sep } from 'node:path';
import { CHAIN, CLASSIC_VAULT_FACTORY, type Hex, type RealTransfer, STRATEGY, VAULT } from './realData';

export { CHAIN };

// biome-ignore lint/suspicious/noExplicitAny: simulate items are a large generated union; builders return plain objects
export type Item = any;

export const transferItem = (
    contract: 'ClassicVault' | 'ClmManager' | 'RewardPool' | 'Token' | 'LstVault' | 'Erc4626Adapter',
    token: string,
    t: RealTransfer
): Item => ({
    contract,
    event: 'Transfer',
    srcAddress: token,
    logIndex: t.logIndex,
    block: { number: t.block, timestamp: t.timestamp },
    transaction: { hash: t.hash, from: t.txFrom },
    params: { from: t.from, to: t.to, value: t.value },
});

/** Real `ProxyCreated` of vault V and strategy S on the Base ClassicVaultFactory, with the real tx input. */
export const vaultCreated = (withInput = true): Item => ({
    contract: 'ClassicVaultFactory',
    event: 'VaultOrStrategyCreated',
    srcAddress: CLASSIC_VAULT_FACTORY,
    logIndex: VAULT.creation.logIndex,
    block: { number: VAULT.creation.block, timestamp: VAULT.creation.timestamp },
    transaction: withInput
        ? { hash: VAULT.creation.hash, from: '0xbbfd9b7e92707a2414231bbb70f1d024bad679e7', input: VAULT.creation.input }
        : { hash: VAULT.creation.hash, from: '0xbbfd9b7e92707a2414231bbb70f1d024bad679e7' },
    params: { proxy: VAULT.address },
});

export const strategyCreated = (withInput = true): Item => ({
    contract: 'ClassicVaultFactory',
    event: 'VaultOrStrategyCreated',
    srcAddress: CLASSIC_VAULT_FACTORY,
    logIndex: STRATEGY.creation.logIndex,
    block: { number: STRATEGY.creation.block, timestamp: 1736907271 },
    transaction: withInput
        ? {
              hash: STRATEGY.creation.hash,
              from: '0xbbfd9b7e92707a2414231bbb70f1d024bad679e7',
              input: STRATEGY.creation.input,
          }
        : { hash: STRATEGY.creation.hash, from: '0xbbfd9b7e92707a2414231bbb70f1d024bad679e7' },
    params: { proxy: STRATEGY.address },
});

export const vaultInitialized = (): Item => ({
    contract: 'ClassicVault',
    event: 'Initialized',
    srcAddress: VAULT.address,
    logIndex: VAULT.initialized.logIndex,
    block: { number: VAULT.initialized.block, timestamp: 1736907277 },
    transaction: { hash: VAULT.initialized.hash, from: '0xbbfd9b7e92707a2414231bbb70f1d024bad679e7' },
    params: { version: 1n },
});

/** 32-byte fake tx hash from a tag. */
export const fakeHash = (tag: number): Hex => `0x${tag.toString(16).padStart(64, 'f')}`;

// ---------------------------------------------------------------------------------------------------------------------
// RPC counter
// ---------------------------------------------------------------------------------------------------------------------

const FIXTURE_DIR = `${sep}test${sep}fixtures${sep}rpc${sep}`;

/**
 * Counts RPC state reads that reach the record/replay layer (src/lib/rpcFixtures.ts checks `existsSync` on the
 * fixture path once per JSON-RPC request, in record and replay mode alike), plus any request that bypasses it
 * through global fetch. The builtin is patched and the ESM named exports re-synced so `import { existsSync }`
 * sees the wrapper.
 */
export const installRpcCounter = () => {
    const requests: string[] = [];
    const originalExists = fs.existsSync;
    fs.existsSync = ((path: fs.PathLike) => {
        const p = String(path);
        if (p.includes(FIXTURE_DIR) && p.endsWith('.json') && !p.includes('.tmp')) requests.push(p);
        return originalExists(path);
    }) as typeof fs.existsSync;
    syncBuiltinESMExports();
    const originalFetch = globalThis.fetch;
    const bypass: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (typeof init?.body === 'string' && init.body.includes('"jsonrpc"')) bypass.push(init.body);
        return originalFetch(input, init);
    }) as typeof fetch;
    return {
        /** fixture lookups (one per RPC request) */
        get count() {
            return requests.length;
        },
        get requests() {
            return [...requests];
        },
        /** method and block tag of every counted request (read back from the recorded fixture) */
        described() {
            return requests.map((p) => {
                const { request } = JSON.parse(fs.readFileSync(p, 'utf8')) as {
                    request: { method: string; params: unknown[] };
                };
                const block = request.params[request.params.length - 1];
                return { method: request.method, block: typeof block === 'string' ? block : undefined };
            });
        },
        /** raw fetches with a JSON-RPC body (record mode misses, or reads outside the fixture layer) */
        get fetches() {
            return [...bypass];
        },
        reset() {
            requests.length = 0;
            bypass.length = 0;
        },
        restore() {
            fs.existsSync = originalExists;
            syncBuiltinESMExports();
            globalThis.fetch = originalFetch;
        },
    };
};
