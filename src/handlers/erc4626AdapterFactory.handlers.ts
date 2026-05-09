import { indexer } from 'envio';

indexer.contractRegister(
    { contract: 'Erc4626AdapterFactory', event: 'Erc4626AdapterCreated' },
    async ({ event, context }) => {
        const adapterAddress = event.params.proxy; // already lowercase by `address_format: lowercase`

        context.chain.Erc4626Adapter.add(adapterAddress);

        context.log.info('Erc4626AdapterCreated', { adapterAddress });
    }
);
