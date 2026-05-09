import { indexer } from 'envio';
import { isVaultBlacklisted } from '../lib/blacklist';
import { normalizeHex } from '../lib/hex';

indexer.contractRegister({ contract: 'ContractFactory', event: 'ContractDeployed' }, async ({ event, context }) => {
    const contractAddress = normalizeHex(event.params.proxy);
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    // const rewardPoolName = event.params.rewardPoolName; // Property doesn't exist

    // Generic contract factory - determine type based on rewardPoolName or add as token
    // For now, we'll skip adding these until we can determine the specific type
    // context.addToken(contractAddress); // TODO: Determine contract type

    context.log.info('ContractDeployed', { contractAddress });
});
