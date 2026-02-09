import { join } from 'node:path';
import { ChainId as AddressBookChainId } from '@beefyfinance/blockchain-addressbook';
import * as R from 'remeda';
import type { Hex } from 'viem';
import { isVaultBlacklisted, rawVaultBlacklist } from '../src/lib/blacklist';
import type { ChainId } from '../src/lib/chain';
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

async function main() {
    const text = await Bun.file(join(__dirname, '../config.yaml')).text();

    const addyRe = /0x[0-9a-fA-F]{40}/;
    let chainId: ChainId = 1;

    const toUnblacklist: { chainId: ChainId; address: Hex }[] = [];

    for (const line of text.split('\n')) {
        if (line.includes('id:')) {
            chainId = parseInt(line.split(':')[1].trim(), 10) as ChainId;
            // biome-ignore lint/style/noNonNullAssertion: ensured to exist
            const [network] = R.pipe(
                AddressBookChainId,
                R.entries(),
                R.filter(([_, id]) => id === chainId),
                R.first()
            )!;

            const [cowVaultsData, mooVaultsData, clmRewardPoolData, [boostData, vaultRewardPoolData]] =
                await Promise.all([
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
                                .filter((g) => g.version === 2),
                        ]),
                    fetch(`${BEEFY_BOOST_API}/${network}`)
                        .then((res) => res.json())
                        .then((res) => [
                            (res as ApiBoost[]).filter((g) => g.chain === network).filter((g) => g.version !== 2),
                            (res as ApiBoost[]).filter((g) => g.chain === network).filter((g) => g.version === 2),
                        ]),
                ]);

            for (const vault of cowVaultsData) {
                if (isVaultBlacklisted(chainId, vault.earnContractAddress)) {
                    toUnblacklist.push({ chainId, address: vault.earnContractAddress as Hex });
                }
            }

            for (const vault of mooVaultsData) {
                if (isVaultBlacklisted(chainId, vault.earnContractAddress)) {
                    toUnblacklist.push({ chainId, address: vault.earnContractAddress as Hex });
                }
            }

            for (const rewardPool of clmRewardPoolData) {
                if (isVaultBlacklisted(chainId, rewardPool.earnContractAddress)) {
                    toUnblacklist.push({ chainId, address: rewardPool.earnContractAddress as Hex });
                }
            }

            for (const boost of boostData) {
                if (isVaultBlacklisted(chainId, boost.earnContractAddress)) {
                    toUnblacklist.push({ chainId, address: boost.earnContractAddress as Hex });
                }
            }

            for (const rewardPool of vaultRewardPoolData) {
                if (isVaultBlacklisted(chainId, rewardPool.earnContractAddress)) {
                    toUnblacklist.push({ chainId, address: rewardPool.earnContractAddress as Hex });
                }
            }
        }

        if (addyRe.test(line)) {
            const address = (line.match(addyRe)?.[0] ?? '').toLowerCase() as Hex;

            // addy is explicitely added to config.yaml, we need! to unblacklist it
            if (isVaultBlacklisted(chainId, address)) {
                toUnblacklist.push({ chainId, address });
            }
        }
    }

    console.log(toUnblacklist);

    if (toUnblacklist.length === 0) {
        console.log('No addresses to unblacklist');
        return;
    }

    const newBlacklist = rawVaultBlacklist.filter(
        (entry) =>
            !toUnblacklist.some(
                (toUnblacklistEntry) =>
                    toUnblacklistEntry.chainId === entry.chainId && toUnblacklistEntry.address === entry.address
            )
    );

    for (const entry of newBlacklist) {
        console.log(`{ chainId: ${entry.chainId}, address: "${entry.address}" },`);
    }
}

main();
