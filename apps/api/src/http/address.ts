const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const isAddress = (value: string): boolean => ADDRESS.test(value);

/** Addresses whose timeline is huge and meaningless. Beefy's own contracts are added at runtime. */
export const staticBlocked = (): string[] => [
    '0x0000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000dead',
    '0xdead000000000000000000000000000000000000',
];
