export const beefySwapperAbi = [
    {
        inputs: [
            { name: 'fromToken', type: 'address' },
            { name: 'toToken', type: 'address' },
            { name: 'amountIn', type: 'uint256' },
        ],
        name: 'getAmountOut',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;
