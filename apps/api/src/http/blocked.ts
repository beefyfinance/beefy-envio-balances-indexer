/** A set of addresses that is replaced as a whole when it is refreshed, so readers never see a half built one. */
export const createBlockedSet = () => {
    let current: ReadonlySet<string> = new Set();
    return {
        current: (): ReadonlySet<string> => current,
        replace: (addresses: readonly string[]): void => {
            current = new Set(addresses.map((address) => address.toLowerCase()));
        },
    };
};
