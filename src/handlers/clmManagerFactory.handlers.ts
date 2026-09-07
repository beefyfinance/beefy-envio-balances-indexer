import { indexer } from 'envio';
import { isVaultBlacklisted } from '../lib/blacklist';
import { toBytes, toHex } from '../lib/hex';

indexer.contractRegister({ contract: 'ClmManagerFactory', event: 'ClmManagerCreated' }, async ({ event, context }) => {
    const contractAddress = toBytes(event.params.proxy);
    if (isVaultBlacklisted(event.chainId, contractAddress)) return;

    context.chain.ClmManager.add(toHex(contractAddress));

    context.log.info('ClmManagerCreated', { contractAddress });
});
