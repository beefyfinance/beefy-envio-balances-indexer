import type { Account, EvmChainId, EvmOnEventContext } from 'envio';
import { isAccountBlacklisted } from '../lib/blacklist';
import { type Bytes, toHex } from '../lib/hex';
export const accountId = ({ accountAddress }: { accountAddress: Bytes }) => `${toHex(accountAddress)}`;

export const getOrCreateAccount = async ({
    context,
    chainId,
    accountAddress,
}: {
    context: EvmOnEventContext;
    chainId: EvmChainId;
    accountAddress: Bytes;
}): Promise<Account | null> => {
    const blacklisted = await isAccountBlacklisted(chainId, accountAddress);
    if (blacklisted) {
        context.log.debug('Account is blacklisted', { chainId, accountAddress: accountAddress });
        return null;
    }
    return await context.Account.getOrCreate({
        id: accountId({ accountAddress }),
        address: accountAddress,
    });
};
