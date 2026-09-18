import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

/** Base BeefySwapper from config.yaml */
const SWAPPER = '0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc' as const;
const FROM_TOKEN = '0x4200000000000000000000000000000000000006' as const;
const TO_TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as const;
const ROUTER = '0xba12222222228d8ba445958a75a0704d566bf2c8' as const;
const ORACLE = '0xdd27227dba7ea8f5869466a10a8e36bb2d709b35' as const;

const block = { number: 12_000_000, timestamp: Math.floor(Date.parse('2024-06-01T00:00:00.000Z') / 1000) };
const trxHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

const setSwapInfo = ({
    logIndex,
    router = ROUTER,
    data = '0x1234',
    minAmountSign = 1n,
}: {
    logIndex: number;
    router?: `0x${string}`;
    data?: `0x${string}`;
    minAmountSign?: bigint;
}) => ({
    contract: 'BeefySwapper' as const,
    event: 'SetSwapInfo' as const,
    block,
    logIndex,
    srcAddress: SWAPPER,
    transaction: { hash: trxHash, transactionIndex: 1 },
    params: {
        fromToken: FROM_TOKEN,
        toToken: TO_TOKEN,
        swapInfo: {
            router,
            data,
            amountIndex: 4n,
            minIndex: 36n,
            minAmountSign,
        },
    },
});

describe('BeefySwapper handlers', () => {
    it('creates a Swapper and SwapperRoute from SetSwapInfo before any oracle event', async () => {
        const indexer = createTestIndexer();
        const trace = await indexer.process({
            chains: {
                8453: {
                    simulate: [setSwapInfo({ logIndex: 0 })],
                },
            },
        });

        expect(trace, 'SetSwapInfo creates the parent Swapper and the route').toMatchInlineSnapshot(`
          {
            "changes": [
              {
                "Swapper": {
                  "sets": [
                    {
                      "address": "0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc",
                      "id": "8453-0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc",
                      "oracle": undefined,
                      "oracleTrxHash": undefined,
                      "slippage": undefined,
                      "slippageTrxHash": undefined,
                    },
                  ],
                },
                "SwapperRoute": {
                  "sets": [
                    {
                      "amountIndex": 4n,
                      "blockNumber": 12000000n,
                      "blockTimestamp": 2024-06-01T00:00:00.000Z,
                      "data": "0x1234",
                      "fromToken_id": "8453-0x4200000000000000000000000000000000000006",
                      "id": "8453-0x4200000000000000000000000000000000000006-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                      "minAmountSign": 1,
                      "minIndex": 36n,
                      "router": "0xba12222222228d8ba445958a75a0704d566bf2c8",
                      "swapper_id": "8453-0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc",
                      "toToken_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                      "trxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    },
                  ],
                },
                "Token": {
                  "sets": [
                    {
                      "address": "0x4200000000000000000000000000000000000006",
                      "decimals": 18,
                      "holderCount": 0,
                      "id": "8453-0x4200000000000000000000000000000000000006",
                      "isVirtual": false,
                      "name": "Wrapped Ether",
                      "symbol": "WETH",
                      "totalSupply": "0",
                    },
                    {
                      "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                      "decimals": 6,
                      "holderCount": 0,
                      "id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                      "isVirtual": false,
                      "name": "USD Coin",
                      "symbol": "USDC",
                      "totalSupply": "0",
                    },
                  ],
                },
                "block": 12000000,
                "chainId": 8453,
                "eventsProcessed": 1,
              },
            ],
          }
        `);
    });

    it('updates the route when SetSwapInfo is emitted again for the same pair', async () => {
        const indexer = createTestIndexer();
        const trace = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        setSwapInfo({ logIndex: 0 }),
                        setSwapInfo({
                            logIndex: 1,
                            router: '0x1111111111111111111111111111111111111111',
                            data: '0xabcd',
                        }),
                    ],
                },
            },
        });

        expect(trace, 'second SetSwapInfo overwrites the route').toMatchInlineSnapshot(`
          {
            "changes": [
              {
                "Swapper": {
                  "sets": [
                    {
                      "address": "0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc",
                      "id": "8453-0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc",
                      "oracle": undefined,
                      "oracleTrxHash": undefined,
                      "slippage": undefined,
                      "slippageTrxHash": undefined,
                    },
                  ],
                },
                "SwapperRoute": {
                  "sets": [
                    {
                      "amountIndex": 4n,
                      "blockNumber": 12000000n,
                      "blockTimestamp": 2024-06-01T00:00:00.000Z,
                      "data": "0xabcd",
                      "fromToken_id": "8453-0x4200000000000000000000000000000000000006",
                      "id": "8453-0x4200000000000000000000000000000000000006-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                      "minAmountSign": 1,
                      "minIndex": 36n,
                      "router": "0x1111111111111111111111111111111111111111",
                      "swapper_id": "8453-0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc",
                      "toToken_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                      "trxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    },
                  ],
                },
                "Token": {
                  "sets": [
                    {
                      "address": "0x4200000000000000000000000000000000000006",
                      "decimals": 18,
                      "holderCount": 0,
                      "id": "8453-0x4200000000000000000000000000000000000006",
                      "isVirtual": false,
                      "name": "Wrapped Ether",
                      "symbol": "WETH",
                      "totalSupply": "0",
                    },
                    {
                      "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                      "decimals": 6,
                      "holderCount": 0,
                      "id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                      "isVirtual": false,
                      "name": "USD Coin",
                      "symbol": "USDC",
                      "totalSupply": "0",
                    },
                  ],
                },
                "block": 12000000,
                "chainId": 8453,
                "eventsProcessed": 2,
              },
            ],
          }
        `);
    });

    it('stores oracle and slippage on the same Swapper without clearing each other', async () => {
        const indexer = createTestIndexer();
        const trace = await indexer.process({
            chains: {
                8453: {
                    simulate: [
                        {
                            contract: 'BeefySwapper' as const,
                            event: 'SetOracle' as const,
                            block,
                            logIndex: 2,
                            srcAddress: SWAPPER,
                            transaction: { hash: trxHash, transactionIndex: 2 },
                            params: { oracle: ORACLE },
                        },
                        {
                            contract: 'BeefySwapper' as const,
                            event: 'SetSlippage' as const,
                            block,
                            logIndex: 3,
                            srcAddress: SWAPPER,
                            transaction: { hash: trxHash, transactionIndex: 3 },
                            params: { slippage: 990000000000000000n },
                        },
                    ],
                },
            },
        });

        expect(trace, 'SetOracle then SetSlippage keep both fields').toMatchInlineSnapshot(`
          {
            "changes": [
              {
                "Swapper": {
                  "sets": [
                    {
                      "address": "0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc",
                      "id": "8453-0x9f8c6a094434c6e6f5f2792088bb4d2d5971ddcc",
                      "oracle": "0xdd27227dba7ea8f5869466a10a8e36bb2d709b35",
                      "oracleTrxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                      "slippage": 990000000000000000n,
                      "slippageTrxHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    },
                  ],
                },
                "block": 12000000,
                "chainId": 8453,
                "eventsProcessed": 2,
              },
            ],
          }
        `);
    });
});
