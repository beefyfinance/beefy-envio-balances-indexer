/**
 * ClassicVaultFactory proxy classification from which detection calls succeed (no imports: shared with
 * scripts/knownContracts.ts, which verifies known contracts the same way). A vault answers `strategy()`, a strategy
 * `vault()`, a boost `rewardToken()`; exactly one must succeed, else the kind is UNKNOWN.
 */
export type ClassicProxyKind = 'VAULT' | 'STRATEGY' | 'BOOST' | 'UNKNOWN';

export const classifyClassicProxyReads = (answers: {
    vault: boolean;
    strategy: boolean;
    rewardToken: boolean;
}): ClassicProxyKind => {
    const matches = [
        answers.strategy ? ('VAULT' as const) : undefined,
        answers.vault ? ('STRATEGY' as const) : undefined,
        answers.rewardToken ? ('BOOST' as const) : undefined,
    ].filter((kind) => kind !== undefined);
    return matches.length === 1 ? (matches[0] ?? 'UNKNOWN') : 'UNKNOWN';
};
