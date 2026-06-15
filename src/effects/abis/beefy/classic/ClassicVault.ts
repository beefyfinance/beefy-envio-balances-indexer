export const classicVaultAbi = [
    {
        inputs: [],
        name: 'token',
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'want',
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'strategy',
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    { inputs: [], name: 'balance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [], name: 'totalAssets', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;
