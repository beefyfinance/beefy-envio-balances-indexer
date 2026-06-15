export const umbrellaPriceFeedAbi = [
    {
        inputs: [{ name: 'name', type: 'bytes32' }],
        name: 'getPriceData',
        outputs: [
            { name: 'decimals', type: 'uint8' },
            { name: 'timestamp', type: 'uint24' },
            { name: 'roundId', type: 'uint32' },
            { name: 'price', type: 'uint128' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
] as const;
