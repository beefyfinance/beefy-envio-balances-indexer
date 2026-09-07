import { indexer } from 'envio';
import { toBytes, toHex } from '../lib/hex';

indexer.contractRegister({ contract: 'ClassicBoostFactory', event: 'BoostCreated' }, async ({ event, context }) => {
    const boostAddress = toBytes(event.params.proxy);

    context.chain.ClassicBoost.add(toHex(boostAddress));

    context.log.info('BoostDeployed', { boostAddress });
});

indexer.contractRegister({ contract: 'ClassicBoostFactory', event: 'BoostDeployed' }, async ({ event, context }) => {
    const boostAddress = toBytes(event.params.boost);

    context.chain.ClassicBoost.add(toHex(boostAddress));

    context.log.info('BoostDeployed', { boostAddress });
});
