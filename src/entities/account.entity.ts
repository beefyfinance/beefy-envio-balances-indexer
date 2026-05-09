import type { Account, EvmChainId, EvmOnEventContext } from 'envio';
import type { Hex } from 'viem';
import { isAccountBlacklisted } from '../lib/blacklist';
import { normalizeHex } from '../lib/hex';

export const accountId = ({ accountAddress }: { accountAddress: Hex }) => `${normalizeHex(accountAddress)}`;

export const getOrCreateAccount = async ({
    context,
    chainId,
    accountAddress,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    accountAddress: Hex;
}): Promise<Account | null> => {
    const blacklisted = await isAccountBlacklisted(chainId, accountAddress);
    if (blacklisted) {
        context.log.debug('Account is blacklisted', { chainId, accountAddress });
        return null;
    }
    return await context.Account.getOrCreate({
        id: accountId({ accountAddress }),
        address: accountAddress,
    });
};
