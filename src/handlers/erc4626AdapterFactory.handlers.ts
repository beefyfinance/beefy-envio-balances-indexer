import { indexer } from 'envio';
import { toBytes, toHex } from '../lib/hex';

indexer.contractRegister(
    { contract: 'Erc4626AdapterFactory', event: 'Erc4626AdapterCreated' },
    async ({ event, context }) => {
        const adapterAddress = toBytes(event.params.proxy);

        context.chain.Erc4626Adapter.add(toHex(adapterAddress));

        context.log.info('Erc4626AdapterCreated', { adapterAddress });
    }
);
