import type { EvmChainId } from 'envio';
import * as R from 'remeda';
import { describe, expect, it } from 'vitest';

import { staticVaultAddresses } from '../config/classic/staticVaults';
import { isVaultBlacklisted } from './blacklist';

describe('vault blacklist', () => {
    it('lists no static vault: its facts are written by hand precisely so that it can be indexed', () => {
        // the blacklist comes from logs of vaults whose underlying token could not be read; a static entry fixes that
        // read, so a vault in both lists (aavev3-op-eth, blacklisted in 2025, given static facts in 2026) lost its rows
        const both = R.filter(staticVaultAddresses(), ({ chainId, address }) =>
            isVaultBlacklisted(chainId as EvmChainId, address)
        );
        expect(both).toEqual([]);
    });
});
