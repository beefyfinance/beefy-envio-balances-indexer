export const clmManagerAbi = [
    { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
    {
        inputs: [],
        name: 'wants',
        outputs: [
            { name: 'token0', type: 'address' },
            { name: 'token1', type: 'address' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'balances',
        outputs: [
            { name: 'amount0', type: 'uint256' },
            { name: 'amount1', type: 'uint256' },
        ],
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
] as const;
