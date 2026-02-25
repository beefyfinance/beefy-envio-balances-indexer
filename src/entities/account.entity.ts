import type { handlerContext as HandlerContext } from 'generated';
import type { Account_t } from 'generated/src/db/Entities.gen';
import type { Hex } from 'viem';
import { isAccountBlacklisted } from '../lib/blacklist';
import type { ChainId } from '../lib/chain';

export const accountId = ({ accountAddress }: { accountAddress: Hex }) => `${accountAddress.toLowerCase()}`;

export const getOrCreateAccount = async ({
    context,
    chainId,
    accountAddress,
}: {
    context: HandlerContext;
    chainId: ChainId;
    accountAddress: Hex;
}): Promise<Account_t | null> => {
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
