export const pythAbi = [
    {
        inputs: [{ name: 'id', type: 'bytes32' }],
        name: 'getPriceUnsafe',
        outputs: [
            { name: 'price', type: 'int64' },
            { name: 'conf', type: 'uint64' },
            { name: 'expo', type: 'int32' },
            { name: 'publishTime', type: 'uint256' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
] as const;
