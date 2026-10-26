/** Minimal ABI for parsing factory tx input (`cloneVault` / `cloneContract` / `booooost`). */
export const classicVaultFactoryAbi = [
    {
        inputs: [{ internalType: 'address', name: 'implementation', type: 'address' }],
        name: 'cloneContract',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [],
        name: 'cloneVault',
        outputs: [{ internalType: 'contract BeefyVaultV7', name: '', type: 'address' }],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'address', name: 'mooToken', type: 'address' },
            { internalType: 'address', name: 'rewardToken', type: 'address' },
            { internalType: 'uint256', name: 'duration_in_sec', type: 'uint256' },
        ],
        name: 'booooost',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
] as const;

export const classicVaultFactoryDetectionAbi = [
    {
        name: 'vault',
        type: 'function',
        inputs: [],
        outputs: [],
    },
    {
        name: 'strategy',
        type: 'function',
        inputs: [],
        outputs: [],
    },
    {
        name: 'rewardToken',
        type: 'function',
        inputs: [],
        outputs: [],
    },
] as const;
