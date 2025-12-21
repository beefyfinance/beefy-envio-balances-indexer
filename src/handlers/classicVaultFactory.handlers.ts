import { ClassicVaultFactory } from 'generated';
import { detectClassicVaultOrStrategy } from '../effects/classicVaultFactory.effects';
import { isVaultBlacklisted } from '../lib/blacklist';

ClassicVaultFactory.VaultOrStrategyCreated.contractRegister(async ({ event, context }) => {
    const proxyAddress = event.params.proxy; // already lowercase by `address_format: lowercase`
    if (isVaultBlacklisted(event.chainId, proxyAddress)) return;

    const transactionHash = event.transaction.hash as `0x${string}`;
    const transactionInput = event.transaction.input as `0x${string}`;

    const { isVault, isStrategy, isBoost } = await detectClassicVaultOrStrategy({
        log: context.log,
        contractAddress: proxyAddress as `0x${string}`,
        chainId: event.chainId,
        blockNumber: event.block.number,
        transactionHash,
        transactionInput,
    });

    if (isVault) {
        context.addClassicVault(proxyAddress);
        context.log.info('Vault detected, adding to context', { proxyAddress });
    } else if (isStrategy) {
        context.log.info('Strategy detected, ignoring', { proxyAddress });
    } else if (isBoost) {
        context.addClassicBoost(proxyAddress);
        context.log.info('Boost detected, adding to context', { proxyAddress });
    }
});
