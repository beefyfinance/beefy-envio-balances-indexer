import { indexer } from 'envio';
import { isVaultBlacklisted } from '../lib/blacklist';
import { toBytes } from '../lib/hex';

// No static ContractFactory addresses are configured on any chain; wildcard so
// ContractDeployed can still be simulated/indexed when emitted.
indexer.contractRegister(
    { contract: 'ContractFactory', event: 'ContractDeployed', wildcard: true },
    async ({ event, context }) => {
        const contractAddress = toBytes(event.params.proxy);
        if (isVaultBlacklisted(event.chainId, contractAddress)) return;

        // Generic contract factory — determine type before adding a dynamic contract.
        // context.addToken(contractAddress); // TODO: Determine contract type

        context.log.info('ContractDeployed', { contractAddress });
    }
);
