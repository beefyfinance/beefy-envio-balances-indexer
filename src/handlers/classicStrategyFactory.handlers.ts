import { indexer } from 'envio';
import { usesClassicStratHarvest1Abi } from '../config/classic/stratHarvest1';
import { isVaultBlacklisted } from '../lib/blacklist';
import { toChainId } from '../lib/chain';
import { toBytes, toHex } from '../lib/hex';

const registerClassicStrategy = ({
    proxy,
    chainId,
    context,
    label,
    strategyName,
}: {
    proxy: string;
    chainId: number;
    context: {
        chain: {
            ClassicStrategy: { add: (address: string) => void };
            ClassicStrategyStratHarvest0: { add: (address: string) => void };
            ClassicStrategyStratHarvest1: { add: (address: string) => void };
        };
        log: { info: (message: string, data: object) => void };
    };
    label: string;
    strategyName?: string;
}) => {
    const contractAddress = toBytes(proxy);
    if (isVaultBlacklisted(chainId, contractAddress)) return;

    const id = toChainId(chainId);
    context.chain.ClassicStrategy.add(toHex(contractAddress));
    if (usesClassicStratHarvest1Abi(id, contractAddress)) {
        context.chain.ClassicStrategyStratHarvest1.add(toHex(contractAddress));
    } else {
        context.chain.ClassicStrategyStratHarvest0.add(toHex(contractAddress));
    }

    context.log.info(label, { contractAddress, strategyName });
};

indexer.contractRegister(
    { contract: 'ClassicStrategyFactory', event: 'StrategyCreated' },
    async ({ event, context }) => {
        registerClassicStrategy({
            proxy: event.params.proxy,
            chainId: event.chainId,
            context,
            label: 'ClassicStrategyCreated',
        });
    }
);

indexer.contractRegister(
    { contract: 'ClassicStrategyFactory', event: 'StrategyCreatedWithName' },
    async ({ event, context }) => {
        registerClassicStrategy({
            proxy: event.params.proxy,
            chainId: event.chainId,
            context,
            label: 'ClassicStrategyCreatedWithName',
            strategyName: event.params.strategyName,
        });
    }
);
