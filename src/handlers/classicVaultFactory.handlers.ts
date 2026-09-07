import { indexer } from 'envio';
import { detectClassicVaultOrStrategy } from '../effects/classicVaultFactory.effects';
import { isVaultBlacklisted } from '../lib/blacklist';
import { toBytes, toHex } from '../lib/hex';

indexer.contractRegister(
    { contract: 'ClassicVaultFactory', event: 'VaultOrStrategyCreated', fields: { transaction: ['hash', 'input'] } },
    async ({ event, context }) => {
        const proxyAddress = toBytes(event.params.proxy);
        if (isVaultBlacklisted(event.chainId, proxyAddress)) return;

        const transactionHash = event.transaction.hash as `0x${string}`;
        const transactionInput = event.transaction.input as `0x${string}`;

        const { isVault, isStrategy, isBoost } = await detectClassicVaultOrStrategy({
            log: context.log,
            contractAddress: proxyAddress,
            chainId: event.chainId,
            blockNumber: event.block.number,
            transactionHash,
            transactionInput,
        });

        if (isVault) {
            context.chain.ClassicVault.add(toHex(proxyAddress));
            context.log.info('Vault detected, adding to context', { proxyAddress });
        } else if (isStrategy) {
            context.log.info('Strategy detected, ignoring', { proxyAddress });
        } else if (isBoost) {
            context.chain.ClassicBoost.add(toHex(proxyAddress));
            context.log.info('Boost detected, adding to context', { proxyAddress });
        }
    }
);
