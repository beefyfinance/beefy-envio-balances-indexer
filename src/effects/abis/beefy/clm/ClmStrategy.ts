export const clmStrategyAbi = [
    {
        inputs: [],
        name: 'vault',
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'balancesOfPool',
        outputs: [
            { name: 'token0Bal', type: 'uint256' },
            { name: 'token1Bal', type: 'uint256' },
            { name: 'mainAmount0', type: 'uint256' },
            { name: 'mainAmount1', type: 'uint256' },
            { name: 'altAmount0', type: 'uint256' },
            { name: 'altAmount1', type: 'uint256' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    { inputs: [], name: 'price', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
    {
        inputs: [],
        name: 'range',
        outputs: [
            { name: 'lowerPrice', type: 'uint256' },
            { name: 'upperPrice', type: 'uint256' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'pool',
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'output',
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;
