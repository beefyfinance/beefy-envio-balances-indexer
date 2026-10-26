export const ierc20Abi = [
    { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
    {
        inputs: [{ name: 'account', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;
