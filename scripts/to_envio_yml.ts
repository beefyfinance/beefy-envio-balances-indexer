import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { addressBook } from '@beefyfinance/blockchain-addressbook';
import * as viemChains from 'viem/chains';

const CONFIG_DIR = '../beefy-balances-subgraph/config';
const DATA_DIR = '../beefy-balances-subgraph/data';

const configFiles = readdirSync(CONFIG_DIR);

const ymls: { chainId: string; yml: string }[] = [];
for (const file of configFiles) {
    const chainId = file.replace('.json', '');
    const config = JSON.parse(readFileSync(`${CONFIG_DIR}/${file}`, 'utf8'));
    const data = JSON.parse(readFileSync(`${DATA_DIR}/${chainId}_data.json`, 'utf8'));

    const chain = Object.entries(viemChains).find(
        ([key, chain]) =>
            chain.name.toLowerCase() === chainId.toLowerCase() ||
            chain.nativeCurrency.name.toLowerCase() === chainId.toLowerCase() ||
            chain.nativeCurrency.symbol.toLowerCase() === chainId.toLowerCase() ||
            key.toLowerCase() === chainId.toLowerCase()
    );
    const networkId = chainId === 'ethereum' ? 1 : chainId === 'hyperevm' ? 999 : chain?.[1].id;

    const ab = addressBook[chainId].platforms.beefyfinance;

    const toEntry = (name: string, prefix: string = '', list: string[]) => {
        const filteredList = list
            .filter((item) => Boolean(item))
            .filter((item) => item !== '0x0000000000000000000000000000000000000000');
        if (filteredList.length === 0) {
            return `\n${prefix}- name: ${name}\n${prefix}  address: []`;
        }

        const uniqueList = [...new Set(filteredList)];

        return `\n${prefix}- name: ${name}\n${prefix}  address: ${toYmlList(uniqueList, `${prefix}    `)}`;
    };
    const toYmlList = (list: string[], prefix: string = '') => {
        return `\n${list.map((item) => `${prefix}- ${item}`).join('\n')}`;
    };

    const blocks = [
        config.firstBlock,
        config.clmManagerFactoryStartBlock,
        config.clmStrategyFactoryStartBlock,
        config.rewardPoolFactoryStartBlock,
        config.beefyClassicVaultFactoryStartBlock,
        config.beefyClassicStrategyFactoryStartBlock,
        config.beefyClassicBoostFactoryStartBlock,
        config.beefyContractDeployerStartBlock,
    ].filter((block) => block !== undefined);
    const start_block = Math.min(...blocks);

    if (!start_block) {
        throw new Error(`No start block found for ${chainId}`);
    }

    const defaultRpc = chainId === 'hyperevm' ? 'https://rpc.hyperliquid.xyz/evm' : chain?.[1].rpcUrls.default.http[0];

    const yml = `  
  - id: ${networkId} # ${chainId}
    start_block: ${start_block}
    rpc: '${defaultRpc}'
    contracts:${[
        toEntry('ClassicVaultFactory', '      ', [
            config.classicVaultFactoryAddress,
            config.classicVaultFactoryAddress_2,
            ab.vaultFactory,
        ]),
        toEntry('ClassicStrategyFactory', '      ', [
            config.classicStrategyFactoryAddress,
            config.classicStrategyFactoryAddress_2,
            ab.strategyFactory,
        ]),
        toEntry('ClassicBoostFactory', '      ', [
            config.classicBoostFactoryAddress,
            config.classicBoostFactoryAddress_2,
            ab.boostFactory,
        ]),
        toEntry('RewardPoolFactory', '      ', [
            config.rewardPoolFactoryAddress,
            config.rewardPoolFactoryAddress_2,
            ab.clmRewardPoolFactory,
        ]),
        toEntry('ClmManagerFactory', '      ', [
            config.clmManagerFactoryAddress,
            config.clmManagerFactoryAddress_2,
            ab.clmFactory,
        ]),
        toEntry('ClmStrategyFactory', '      ', [
            config.clmStrategyFactoryAddress,
            config.clmStrategyFactoryAddress_2,
            ab.clmStrategyFactory,
        ]),
        toEntry('ContractFactory', '      ', [
            config.contractFactoryAddress,
            config.contractFactoryAddress_2,
            ab.beefyContractDeployerAddress,
        ]),
        toEntry('Erc4626AdapterFactory', '      ', [
            config.erc4626AdapterFactoryAddress,
            config.erc4626AdapterFactoryAddress_2,
            ab.wrapperFactory,
        ]),
        toEntry('ClassicVault', '      ', data.no_factory_vaults ?? []),
        toEntry('ClassicBoost', '      ', data.no_factory_boosts ?? []),
        toEntry('ClassicStrategy', '      ', data.no_factory_strategies ?? []),
        toEntry('ClmStrategy', '      ', data.no_factory_clm_strategies ?? []),
        toEntry('ClmManager', '      ', data.no_factory_clm_managers ?? []),
        toEntry('RewardPool', '      ', data.no_factory_reward_pools ?? []),
        toEntry('LstVault', '      ', data.no_factory_lst_vaults ?? []),
        toEntry('Erc4626Adapter', '      ', data.no_factory_erc4626_adapters ?? []),
    ].join('')}
    `;
    ymls.push({ chainId, yml });
}

// sort by chainId
ymls.sort((a, b) => a.chainId.localeCompare(b.chainId));

writeFileSync('networks_config.yaml', ymls.map((yml) => yml.yml).join(''));
