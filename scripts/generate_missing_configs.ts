import { ChainId as AddressBookChainId, addressBook } from '@beefyfinance/blockchain-addressbook';
import { sql } from 'bun';
import * as R from 'remeda';
import {
    type ApiBoost,
    type ApiClmManager,
    type ApiClmRewardPoolOrOldGovVaultOrLstVault,
    type ApiVault,
    BEEFY_BOOST_API,
    BEEFY_COW_VAULT_API,
    BEEFY_GOV_API,
    BEEFY_MOO_VAULT_API,
} from './lib/beefy-api';

process.env.DATABASE_URL = 'postgres://postgres:testing@localhost:5433/envio-dev';

const main = async () => {
    const excludedNetworks = ['emerald', 'fuse', 'heco', 'one', 'real', 'cronos', 'moonriver', 'canto'];
    const networks = R.keys(addressBook).filter((network) => !excludedNetworks.includes(network));

    const allTokens = (await sql`select * from "Token"`) as { id: string; address: string; chainId: number }[];

    for (const network of networks) {
        const networkId: number = AddressBookChainId[network];
        console.log({ network, networkId });

        const [
            cowVaultsData,
            mooVaultsData,
            [oldGovVaults, oldLstVaults, clmRewardPoolData],
            [boostData, vaultRewardPoolData],
        ] = await Promise.all([
            fetch(`${BEEFY_COW_VAULT_API}/${network}`)
                .then((res) => res.json())
                .then((res) => (res as ApiClmManager[]).filter((vault) => vault.chain === network)),
            fetch(`${BEEFY_MOO_VAULT_API}/${network}`)
                .then((res) => res.json())
                .then((res) =>
                    (res as ApiVault[])
                        .filter((vault) => vault.chain === network)
                        .filter((vault) => vault.isGovVault !== true)
                ),
            fetch(`${BEEFY_GOV_API}/${network}`)
                .then((res) => res.json())
                .then((res) => [
                    (res as ApiClmRewardPoolOrOldGovVaultOrLstVault[])
                        .filter((g) => g.chain === network)
                        .filter((g) => g.version !== 2 && g.oracleId === 'oldBIFI'),
                    (res as ApiClmRewardPoolOrOldGovVaultOrLstVault[])
                        .filter((g) => g.chain === network)
                        .filter((g) => g.version !== 2 && g.oracleId !== 'oldBIFI'),
                    (res as ApiClmRewardPoolOrOldGovVaultOrLstVault[])
                        .filter((g) => g.chain === network)
                        .filter((g) => g.version === 2),
                ]),
            fetch(`${BEEFY_BOOST_API}/${network}`)
                .then((res) => res.json())
                .then((res) => [
                    (res as ApiBoost[]).filter((g) => g.chain === network).filter((g) => g.version !== 2),
                    (res as ApiBoost[]).filter((g) => g.chain === network).filter((g) => g.version === 2),
                ]),
        ]);
        const dbTokens = R.pipe(
            allTokens,
            R.filter((row) => row.chainId === networkId)
        );

        const toKey = (a: string) => `${networkId}-${a.toLowerCase()}`;

        const vaultConfigsMissingInDb = R.differenceWith(
            mooVaultsData,
            dbTokens,
            (configVault, dbToken) => dbToken.id.toLowerCase() === toKey(configVault.earnContractAddress)
        );
        const boostConfigsMissingInDb = R.differenceWith(
            boostData,
            dbTokens,
            (configBoost, dbToken) => dbToken.id.toLowerCase() === toKey(configBoost.earnContractAddress)
        );
        const cowVaultConfigsMissingInDb = R.differenceWith(
            cowVaultsData,
            dbTokens,
            (configCowVault, dbToken) => dbToken.id.toLowerCase() === toKey(configCowVault.earnContractAddress)
        );
        const oldGovVaultConfigsMissingInDb = R.differenceWith(
            oldGovVaults,
            dbTokens,
            (configOldGovVault, dbToken) => dbToken.id.toLowerCase() === toKey(configOldGovVault.earnContractAddress)
        );
        const oldLstVaultConfigsMissingInDb = R.differenceWith(
            oldLstVaults,
            dbTokens,
            (configOldLstVault, dbToken) => dbToken.id.toLowerCase() === toKey(configOldLstVault.earnContractAddress)
        );
        const rewardPoolConfigsMissingInDb = R.differenceWith(
            clmRewardPoolData
                .map((c) => ({
                    id: c.id,
                    earnContractAddress: c.earnContractAddress,
                }))
                .concat(
                    vaultRewardPoolData.map((vaultRewardPool) => ({
                        id: vaultRewardPool.id,
                        earnContractAddress: vaultRewardPool.earnContractAddress,
                    }))
                ),
            dbTokens,
            (configRewardPool, dbToken) => dbToken.id.toLowerCase() === toKey(configRewardPool.earnContractAddress)
        );

        // Generate YAML snippets for missing config addresses for this network

        // Helper to format addresses as YAML array
        function formatYamlArray(addresses: string[], indent = 10) {
            if (addresses.length === 0) return '[]';
            const pad = ' '.repeat(indent);
            return `\n${addresses.map((addr) => `${pad}- ${addr}`).join('\n')}`;
        }

        // Compose YAML for this network
        const yamlSnippet = `
          - id: ${networkId} # ${network}
            # start_block: <FILL_ME>
            # rpc: \${ENVIO_${network.toUpperCase()}_RPC_URL}
            contracts:
              - name: ClassicVault
                address: ${formatYamlArray(vaultConfigsMissingInDb.map((vault) => vault.earnContractAddress))}
              - name: ClassicBoost
                address: ${formatYamlArray(boostConfigsMissingInDb.map((boost) => boost.earnContractAddress))}${formatYamlArray(oldGovVaultConfigsMissingInDb.map((oldGovVault) => oldGovVault.earnContractAddress))}
              - name: ClmManager
                address: ${formatYamlArray(cowVaultConfigsMissingInDb.map((cowVault) => cowVault.earnContractAddress))}
              - name: RewardPool
                address: ${formatYamlArray(rewardPoolConfigsMissingInDb.map((rewardPool) => rewardPool.earnContractAddress))}
              - name: LstVault
                address: ${formatYamlArray(oldLstVaultConfigsMissingInDb.map((oldLstVault) => oldLstVault.earnContractAddress))}
              
        `;

        console.log(`\n# YAML config snippet for network: ${network} (${networkId})`);
        console.log(yamlSnippet);
    }
};

main();
