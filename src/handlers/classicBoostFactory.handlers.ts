import { ClassicBoostFactory } from 'generated';

ClassicBoostFactory.BoostCreated.contractRegister(async ({ event, context }) => {
    const boostAddress = event.params.proxy; // already lowercase by `address_format: lowercase`

    context.addClassicBoost(boostAddress);

    context.log.info('BoostDeployed', { boostAddress });
});

ClassicBoostFactory.BoostDeployed.contractRegister(async ({ event, context }) => {
    const boostAddress = event.params.boost; // already lowercase by `address_format: lowercase`

    context.addClassicBoost(boostAddress);

    context.log.info('BoostDeployed', { boostAddress });
});
