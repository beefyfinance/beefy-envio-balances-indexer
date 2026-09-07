export const beefyOracleAbi = [
    {
        inputs: [{ name: 'token', type: 'address' }],
        name: 'getFreshPrice',
        outputs: [
            { name: 'price', type: 'uint256' },
            { name: 'success', type: 'bool' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [{ name: 'token', type: 'address' }],
        name: 'getPrice',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;
