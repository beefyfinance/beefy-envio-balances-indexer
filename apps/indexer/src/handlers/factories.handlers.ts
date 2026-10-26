/**
 * Factory events: dynamic registration (`contractRegister`, no effects available there, so no RPC) and the
 * `Contract` registry row (`onEvent`).
 */

import { indexer } from 'envio';

import { classifyClassicProxy } from '../effects/facts.effects';
import { isVaultBlacklisted } from '../lib/blacklist';
import { asHex } from '../lib/hex';
import { classifyFromInput, decodeBytes32Name, registerClassicStrategy, staticClassicKind } from '../lib/register';
import { registerCreatedContract } from '../lib/registry';

indexer.contractRegister(
    { contract: 'ClassicVaultFactory', event: 'VaultOrStrategyCreated' },
    async ({ event, context }) => {
        const proxy = asHex(event.params.proxy);
        if (isVaultBlacklisted(event.chainId, proxy)) return;
        const kind = classifyFromInput(event.transaction.input);
        // A known contract listed in config.yaml is already routed from the chain start: registering every
        // candidate would only open one dynamic partition per contract type for nothing.
        if (kind === undefined && staticClassicKind(event.chainId, proxy)) return;
        // Kind not pinned by the input: register every candidate. The onEvent handler below classifies the proxy
        // with one cached read and product handlers skip events of an address whose Contract.kind is another kind.
        if (kind === undefined || kind === 'VAULT') context.chain.ClassicVault.add(proxy);
        if (kind === undefined) registerClassicStrategy(context, event.chainId, proxy);
        if (kind === undefined || kind === 'BOOST') context.chain.ClassicBoost.add(proxy);
    }
);

indexer.onEvent({ contract: 'ClassicVaultFactory', event: 'VaultOrStrategyCreated' }, async ({ event, context }) => {
    const proxy = asHex(event.params.proxy);
    if (isVaultBlacklisted(event.chainId, proxy)) return;
    const known = classifyFromInput(event.transaction.input) ?? staticClassicKind(event.chainId, proxy);
    const kind = known ?? (await context.effect(classifyClassicProxy, { address: proxy })).kind;
    await registerCreatedContract(context, event, { address: proxy, kind });
});

indexer.contractRegister(
    { contract: 'ClassicStrategyFactory', event: 'StrategyCreated' },
    async ({ event, context }) => {
        if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
        registerClassicStrategy(context, event.chainId, event.params.proxy);
    }
);

indexer.contractRegister(
    { contract: 'ClassicStrategyFactory', event: 'StrategyCreatedWithName' },
    async ({ event, context }) => {
        if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
        registerClassicStrategy(context, event.chainId, event.params.proxy);
    }
);

indexer.onEvent({ contract: 'ClassicStrategyFactory', event: 'StrategyCreated' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    await registerCreatedContract(context, event, { address: event.params.proxy, kind: 'STRATEGY' });
});

indexer.onEvent(
    { contract: 'ClassicStrategyFactory', event: 'StrategyCreatedWithName' },
    async ({ event, context }) => {
        if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
        await registerCreatedContract(context, event, {
            address: event.params.proxy,
            kind: 'STRATEGY',
            deployName: event.params.strategyName,
        });
    }
);

indexer.contractRegister({ contract: 'ClassicBoostFactory', event: 'BoostCreated' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    context.chain.ClassicBoost.add(asHex(event.params.proxy));
});

indexer.contractRegister({ contract: 'ClassicBoostFactory', event: 'BoostDeployed' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.boost)) return;
    context.chain.ClassicBoost.add(asHex(event.params.boost));
});

indexer.onEvent({ contract: 'ClassicBoostFactory', event: 'BoostCreated' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    await registerCreatedContract(context, event, { address: event.params.proxy, kind: 'BOOST' });
});

indexer.onEvent({ contract: 'ClassicBoostFactory', event: 'BoostDeployed' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.boost)) return;
    await registerCreatedContract(context, event, { address: event.params.boost, kind: 'BOOST' });
});

indexer.contractRegister({ contract: 'RewardPoolFactory', event: 'RewardPoolCreated' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    context.chain.RewardPool.add(asHex(event.params.proxy));
});

indexer.contractRegister(
    { contract: 'RewardPoolFactory', event: 'RewardPoolCreatedWithName' },
    async ({ event, context }) => {
        if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
        context.chain.RewardPool.add(asHex(event.params.proxy));
    }
);

indexer.onEvent({ contract: 'RewardPoolFactory', event: 'RewardPoolCreated' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    await registerCreatedContract(context, event, { address: event.params.proxy, kind: 'REWARD_POOL' });
});

indexer.onEvent({ contract: 'RewardPoolFactory', event: 'RewardPoolCreatedWithName' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    await registerCreatedContract(context, event, {
        address: event.params.proxy,
        kind: 'REWARD_POOL',
        deployName: event.params.rewardPoolName,
    });
});

indexer.contractRegister({ contract: 'ClmManagerFactory', event: 'ClmManagerCreated' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    context.chain.ClmManager.add(asHex(event.params.proxy));
});

indexer.onEvent({ contract: 'ClmManagerFactory', event: 'ClmManagerCreated' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    await registerCreatedContract(context, event, { address: event.params.proxy, kind: 'CLM_MANAGER' });
});

indexer.contractRegister(
    { contract: 'ClmStrategyFactory', event: 'ClmStrategyCreated' },
    async ({ event, context }) => {
        if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
        context.chain.ClmStrategy.add(asHex(event.params.proxy));
    }
);

indexer.contractRegister(
    { contract: 'ClmStrategyFactory', event: 'ClmStrategyCreatedWithName' },
    async ({ event, context }) => {
        if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
        context.chain.ClmStrategy.add(asHex(event.params.proxy));
    }
);

indexer.onEvent({ contract: 'ClmStrategyFactory', event: 'ClmStrategyCreated' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    await registerCreatedContract(context, event, { address: event.params.proxy, kind: 'CLM_STRATEGY' });
});

indexer.onEvent({ contract: 'ClmStrategyFactory', event: 'ClmStrategyCreatedWithName' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    await registerCreatedContract(context, event, {
        address: event.params.proxy,
        kind: 'CLM_STRATEGY',
        deployName: event.params.strategyName,
    });
});

indexer.contractRegister(
    { contract: 'Erc4626AdapterFactory', event: 'Erc4626AdapterCreated' },
    async ({ event, context }) => {
        if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
        context.chain.Erc4626Adapter.add(asHex(event.params.proxy));
    }
);

indexer.onEvent({ contract: 'Erc4626AdapterFactory', event: 'Erc4626AdapterCreated' }, async ({ event, context }) => {
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    await registerCreatedContract(context, event, { address: event.params.proxy, kind: 'ERC4626_ADAPTER' });
});

/** ContractFactory addresses configured in config.yaml, per chain (none today). */
const contractFactories = new Map(
    indexer.chainIds.map((chainId) => [chainId, new Set(indexer.chains[chainId].ContractFactory.addresses.map(asHex))])
);

// Bound to the configured ContractFactory addresses (none today, so this costs no fetching). Not a wildcard: a
// wildcard scans every chain's full history for this topic, and anyone can emit ContractDeployed(bytes32,address)
// with a predictable clone address. The source check stays as a guard. The deployed kind is unknown.
indexer.onEvent({ contract: 'ContractFactory', event: 'ContractDeployed' }, async ({ event, context }) => {
    if (!contractFactories.get(event.chainId)?.has(asHex(event.srcAddress))) return;
    if (isVaultBlacklisted(event.chainId, event.params.proxy)) return;
    await registerCreatedContract(context, event, {
        address: event.params.proxy,
        kind: 'UNKNOWN',
        deployName: decodeBytes32Name(event.params.contractName),
    });
});
