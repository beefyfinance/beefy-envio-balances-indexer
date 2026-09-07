export const umbrellaRegistryAbi = [
    {
        inputs: [{ name: 'key', type: 'bytes32' }],
        name: 'getAddress',
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;
