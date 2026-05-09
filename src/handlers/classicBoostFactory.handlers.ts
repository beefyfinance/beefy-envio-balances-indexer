import { indexer } from 'envio';

indexer.contractRegister({ contract: 'ClassicBoostFactory', event: 'BoostCreated' }, async ({ event, context }) => {
    const boostAddress = event.params.proxy; // already lowercase by `address_format: lowercase`

    context.chain.ClassicBoost.add(boostAddress);

    context.log.info('BoostDeployed', { boostAddress });
});

indexer.contractRegister({ contract: 'ClassicBoostFactory', event: 'BoostDeployed' }, async ({ event, context }) => {
    const boostAddress = event.params.boost; // already lowercase by `address_format: lowercase`

    context.chain.ClassicBoost.add(boostAddress);

    context.log.info('BoostDeployed', { boostAddress });
});
