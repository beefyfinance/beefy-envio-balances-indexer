import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';
import {
    BASE_CLAIMED_FEES,
    BASE_DEPOSIT,
    BASE_HARVEST,
    BASE_TVL,
    eventMeta,
    initBaseClmSim,
    MANAGER_BASE,
    STRATEGY_BASE,
} from './testFixtures/clm';

describe('ClmStrategy Handlers', () => {
    const blockNum = 15_683_455;
    const timestampSec = Math.floor(Date.parse('2024-07-15T12:00:00.000Z') / 1000);

    describe('Initialized event', () => {
        it('Should create ClmStrategy entity when Initialized event is emitted', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmManager',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: MANAGER_BASE,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClmStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 1,
                                srcAddress: STRATEGY_BASE,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });

            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should create ClmStrategy entity linked to existing ClmManager').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 15683455n,
                          "initializedTimestamp": "2024-07-15T12:00:00.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0",
                          "nativeToUSDPrice": "0",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "0",
                          "priceRangeMax1": "0",
                          "priceRangeMin1": "0",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "0",
                          "token1ToNativePrice": "0",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0",
                          "totalUnderlyingAmount1": "0",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0",
                          "underlyingMainAmount1": "0",
                          "underlyingProtocolPool": "0x0000000000000000000000000000000000000000",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 15683455n,
                          "initializedTimestamp": "2024-07-15T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDC",
                          "symbol": "cowSushiBaseWETH-USDC",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x4200000000000000000000000000000000000006",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x4200000000000000000000000000000000000006",
                          "isVirtual": false,
                          "name": "Wrapped Ether",
                          "symbol": "WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                          "chainId": 8453,
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
                    "block": 15683455,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                ],
              }
            `);
        });

        it('Should handle already initialized ClmStrategy gracefully', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmManager',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: MANAGER_BASE,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClmStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 1,
                                srcAddress: STRATEGY_BASE,
                                params: { version: 1n },
                            },
                            {
                                contract: 'ClmStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 2,
                                srcAddress: STRATEGY_BASE,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });

            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return early without errors when ClmStrategy is already initialized'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZING",
                          "initializedBlock": 15683455n,
                          "initializedTimestamp": "2024-07-15T12:00:00.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "0",
                          "nativeToUSDPrice": "0",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "0",
                          "priceRangeMax1": "0",
                          "priceRangeMin1": "0",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "0",
                          "token1ToNativePrice": "0",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0",
                          "totalUnderlyingAmount1": "0",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0",
                          "underlyingMainAmount1": "0",
                          "underlyingProtocolPool": "0x0000000000000000000000000000000000000000",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 15683455n,
                          "initializedTimestamp": "2024-07-15T12:00:00.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDC",
                          "symbol": "cowSushiBaseWETH-USDC",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x4200000000000000000000000000000000000006",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x4200000000000000000000000000000000000006",
                          "isVirtual": false,
                          "name": "Wrapped Ether",
                          "symbol": "WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                          "chainId": 8453,
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
                    "block": 15683455,
                    "chainId": 8453,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });

        it('Should skip ClmStrategy with zero address manager', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: '0x0000000000000000000000000000000000000001',
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should return null and log error when manager address is zero').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 15683455,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });

        it('Should skip ClmStrategy when parent ClmManager does not exist', async () => {
            const indexer = createTestIndexer();

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmStrategy',
                                event: 'Initialized',
                                block: { number: blockNum, timestamp: timestampSec },
                                logIndex: 0,
                                srcAddress: STRATEGY_BASE,
                                params: { version: 1n },
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should return null and log warning when ClmManager parent entity does not exist'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 15683455,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });

    describe('Harvest event', () => {
        it('Should create ClmHarvestEvent when Harvest event is emitted', async () => {
            const indexer = createTestIndexer();
            const block = { number: BASE_HARVEST.blockNum, timestamp: BASE_HARVEST.timestampSec };

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initBaseClmSim({ blockNum: block.number, timestampSec: block.timestamp }),
                            {
                                contract: 'ClmStrategy',
                                event: 'Harvest',
                                srcAddress: STRATEGY_BASE,
                                params: {
                                    fee0: BASE_HARVEST.fee0,
                                    fee1: BASE_HARVEST.fee1,
                                },
                                ...eventMeta({
                                    block,
                                    trxHash: BASE_HARVEST.trxHash,
                                    trxIndex: BASE_HARVEST.trxIndex,
                                    logIndex: BASE_HARVEST.logIndex,
                                }),
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should create ClmHarvestEvent with compounded fee amounts').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17487152n,
                          "initializedTimestamp": "2024-07-23T19:40:51.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                          "underlyingProtocolPool": "0x57713f7716e0b0f65ec116912f834e49805480d2",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmHarvestEvent": {
                      "sets": [
                        {
                          "blockNumber": 17487152n,
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "collectedOutputAmounts": [],
                          "compoundedAmount0": "0.000052503818585178",
                          "compoundedAmount1": "0.27319",
                          "id": "8453-0x7e29db7de6b8d447c99f929ab6d2fdb8acf913f66d011e4885293bb0977663d2-51-4205",
                          "logIndex": 4205,
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "trxHash": "0x7e29db7de6b8d447c99f929ab6d2fdb8acf913f66d011e4885293bb0977663d2",
                          "trxIndex": 51,
                          "underlyingAmount0": "0.231400863604522132",
                          "underlyingAmount1": "1197.63058",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17487152n,
                          "initializedTimestamp": "2024-07-23T19:40:51.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-3600-1721761200",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "period": 3600n,
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-23T19:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                        },
                        {
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-86400-1721692800",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "period": 86400n,
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-23T00:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                        },
                        {
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-604800-1721520000",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "period": 604800n,
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-21T00:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                        },
                      ],
                    },
                    "ClmStrategy": {
                      "sets": [
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17487152n,
                          "initializedTimestamp": "2024-07-23T19:40:51.000Z",
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDC",
                          "symbol": "cowSushiBaseWETH-USDC",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x4200000000000000000000000000000000000006",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x4200000000000000000000000000000000000006",
                          "isVirtual": false,
                          "name": "Wrapped Ether",
                          "symbol": "WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                          "chainId": 8453,
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
                    "block": 17487152,
                    "chainId": 8453,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });

        it('Should skip Harvest when ClmStrategy entity does not exist', async () => {
            const indexer = createTestIndexer();
            const block = { number: BASE_HARVEST.blockNum, timestamp: BASE_HARVEST.timestampSec };

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmStrategy',
                                event: 'Harvest',
                                srcAddress: STRATEGY_BASE,
                                params: {
                                    fee0: BASE_HARVEST.fee0,
                                    fee1: BASE_HARVEST.fee1,
                                },
                                ...eventMeta({
                                    block,
                                    trxHash: BASE_HARVEST.trxHash,
                                    trxIndex: BASE_HARVEST.trxIndex,
                                    logIndex: BASE_HARVEST.logIndex,
                                }),
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should return early when ClmStrategy entity does not exist').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 17487152,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });

    describe('ClaimedFees event', () => {
        it('Should create ClmManagerCollectionEvent when ClaimedFees event is emitted', async () => {
            const indexer = createTestIndexer();
            const block = { number: BASE_CLAIMED_FEES.blockNum, timestamp: BASE_CLAIMED_FEES.timestampSec };

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initBaseClmSim({ blockNum: block.number, timestampSec: block.timestamp }),
                            {
                                contract: 'ClmStrategy',
                                event: 'ClaimedFees',
                                srcAddress: STRATEGY_BASE,
                                params: {
                                    feeMain0: BASE_CLAIMED_FEES.feeMain0,
                                    feeMain1: BASE_CLAIMED_FEES.feeMain1,
                                    feeAlt0: BASE_CLAIMED_FEES.feeAlt0,
                                    feeAlt1: BASE_CLAIMED_FEES.feeAlt1,
                                },
                                ...eventMeta({
                                    block,
                                    trxHash: BASE_CLAIMED_FEES.trxHash,
                                    trxIndex: BASE_CLAIMED_FEES.trxIndex,
                                    logIndex: BASE_CLAIMED_FEES.logIndex,
                                }),
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(
                trace,
                'Should create ClmManagerCollectionEvent with main and alt fee amounts'
            ).toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17487152n,
                          "initializedTimestamp": "2024-07-23T19:40:51.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                          "underlyingProtocolPool": "0x57713f7716e0b0f65ec116912f834e49805480d2",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17487152n,
                          "initializedTimestamp": "2024-07-23T19:40:51.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManagerCollectionEvent": {
                      "sets": [
                        {
                          "blockNumber": 17487152n,
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "collectedAmount0": "0.00003575483041733",
                          "collectedAmount1": "0.212505",
                          "collectedOutputAmounts": [],
                          "id": "8453-0x7e29db7de6b8d447c99f929ab6d2fdb8acf913f66d011e4885293bb0977663d2-51-4184",
                          "logIndex": 4184,
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "rewardToNativePrices": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "trxHash": "0x7e29db7de6b8d447c99f929ab6d2fdb8acf913f66d011e4885293bb0977663d2",
                          "trxIndex": 51,
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingAmount0": "0.231400863604522132",
                          "underlyingAmount1": "1197.63058",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                        },
                      ],
                    },
                    "ClmSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-3600-1721761200",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "period": 3600n,
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-23T19:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                        },
                        {
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-86400-1721692800",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "period": 86400n,
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-23T00:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                        },
                        {
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-604800-1721520000",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "period": 604800n,
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-21T00:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                        },
                      ],
                    },
                    "ClmStrategy": {
                      "sets": [
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17487152n,
                          "initializedTimestamp": "2024-07-23T19:40:51.000Z",
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDC",
                          "symbol": "cowSushiBaseWETH-USDC",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x4200000000000000000000000000000000000006",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x4200000000000000000000000000000000000006",
                          "isVirtual": false,
                          "name": "Wrapped Ether",
                          "symbol": "WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                          "chainId": 8453,
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
                    "block": 17487152,
                    "chainId": 8453,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });
    });

    describe('TVL event', () => {
        it('Should create ClmStrategyTvlEvent when TVL event is emitted', async () => {
            const indexer = createTestIndexer();
            const block = { number: BASE_TVL.blockNum, timestamp: BASE_TVL.timestampSec };

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initBaseClmSim({ blockNum: block.number, timestampSec: block.timestamp }),
                            {
                                contract: 'ClmStrategy',
                                event: 'TVL',
                                srcAddress: STRATEGY_BASE,
                                params: {
                                    bal0: BASE_TVL.bal0,
                                    bal1: BASE_TVL.bal1,
                                },
                                ...eventMeta({
                                    block,
                                    trxHash: BASE_TVL.trxHash,
                                    trxIndex: BASE_TVL.trxIndex,
                                    logIndex: BASE_TVL.logIndex,
                                }),
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should create ClmStrategyTvlEvent with underlying balances').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17487152n,
                          "initializedTimestamp": "2024-07-23T19:40:51.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                          "underlyingProtocolPool": "0x57713f7716e0b0f65ec116912f834e49805480d2",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17487152n,
                          "initializedTimestamp": "2024-07-23T19:40:51.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-3600-1721761200",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "period": 3600n,
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-23T19:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                        },
                        {
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-86400-1721692800",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "period": 86400n,
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-23T00:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                        },
                        {
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-604800-1721520000",
                          "managerTotalSupply": "1.995477855e-9",
                          "nativeToUSDPrice": "3476.64991803",
                          "outputToNativePrices": [],
                          "period": 604800n,
                          "priceOfToken0InToken1": "3476.243747",
                          "priceRangeMax1": "3662.833661",
                          "priceRangeMin1": "3184.336896",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-21T00:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000287621245617",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.231400863604522132",
                          "totalUnderlyingAmount1": "1197.63058",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.207238217227238923",
                          "underlyingMainAmount1": "1197.90377",
                        },
                      ],
                    },
                    "ClmStrategy": {
                      "sets": [
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17487152n,
                          "initializedTimestamp": "2024-07-23T19:40:51.000Z",
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "ClmStrategyTvlEvent": {
                      "sets": [
                        {
                          "blockNumber": 17487152n,
                          "blockTimestamp": "2024-07-23T19:40:51.000Z",
                          "chainId": 8453,
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x7e29db7de6b8d447c99f929ab6d2fdb8acf913f66d011e4885293bb0977663d2-51-4201",
                          "logIndex": 4201,
                          "trxHash": "0x7e29db7de6b8d447c99f929ab6d2fdb8acf913f66d011e4885293bb0977663d2",
                          "trxIndex": 51,
                          "underlyingAmount0": "1.4480795954e-8",
                          "underlyingAmount1": "3178.280166",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDC",
                          "symbol": "cowSushiBaseWETH-USDC",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x4200000000000000000000000000000000000006",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x4200000000000000000000000000000000000006",
                          "isVirtual": false,
                          "name": "Wrapped Ether",
                          "symbol": "WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                          "chainId": 8453,
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
                    "block": 17487152,
                    "chainId": 8453,
                    "eventsProcessed": 3,
                  },
                ],
              }
            `);
        });

        it('Should skip TVL when ClmStrategy entity does not exist', async () => {
            const indexer = createTestIndexer();
            const block = { number: BASE_TVL.blockNum, timestamp: BASE_TVL.timestampSec };

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            {
                                contract: 'ClmStrategy',
                                event: 'TVL',
                                srcAddress: STRATEGY_BASE,
                                params: {
                                    bal0: BASE_TVL.bal0,
                                    bal1: BASE_TVL.bal1,
                                },
                                ...eventMeta({
                                    block,
                                    trxHash: BASE_TVL.trxHash,
                                    trxIndex: BASE_TVL.trxIndex,
                                    logIndex: BASE_TVL.logIndex,
                                }),
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should return early when ClmStrategy entity does not exist').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "block": 17487152,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });

    describe('Paused and Unpaused events', () => {
        const initBlockNum = BASE_DEPOSIT.blockNum;
        const initTimestampSec = BASE_DEPOSIT.timestampSec;
        const pauseBlockNum = initBlockNum + 1;
        const pauseTimestampSec = initTimestampSec + 12;

        it('Should update Clm pausableStatus when Paused then Unpaused events are emitted', async () => {
            const indexer = createTestIndexer();
            const initBlock = { number: initBlockNum, timestamp: initTimestampSec };
            const pauseBlock = { number: pauseBlockNum, timestamp: pauseTimestampSec };
            const unpauseBlock = { number: pauseBlockNum + 1, timestamp: pauseTimestampSec + 12 };

            const trace = await indexer.process({
                chains: {
                    8453: {
                        simulate: [
                            ...initBaseClmSim({
                                blockNum: initBlock.number,
                                timestampSec: initBlock.timestamp,
                            }),
                            {
                                contract: 'ClmStrategy',
                                event: 'Paused',
                                srcAddress: STRATEGY_BASE,
                                params: {},
                                block: pauseBlock,
                                logIndex: 2,
                            },
                            {
                                contract: 'ClmStrategy',
                                event: 'Unpaused',
                                srcAddress: STRATEGY_BASE,
                                params: {},
                                block: unpauseBlock,
                                logIndex: 3,
                            },
                        ],
                    },
                },
            });
            expect(trace.changes.length).toBeGreaterThan(0);
            expect(trace, 'Should set Clm pausableStatus to PAUSED then back to RUNNING').toMatchInlineSnapshot(`
              {
                "changes": [
                  {
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": "2024-07-23T00:24:27.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "1.0342879e-11",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                          "underlyingProtocolPool": "0x57713f7716e0b0f65ec116912f834e49805480d2",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmManager": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clm_id": undefined,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": "2024-07-23T00:24:27.000Z",
                          "shareToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "ClmSnapshot": {
                      "sets": [
                        {
                          "blockTimestamp": "2024-07-23T00:24:27.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-3600-1721692800",
                          "managerTotalSupply": "1.0342879e-11",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "period": 3600n,
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-23T00:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                        },
                        {
                          "blockTimestamp": "2024-07-23T00:24:27.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-86400-1721692800",
                          "managerTotalSupply": "1.0342879e-11",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "period": 86400n,
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-23T00:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                        },
                        {
                          "blockTimestamp": "2024-07-23T00:24:27.000Z",
                          "chainId": 8453,
                          "clm_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7-604800-1721520000",
                          "managerTotalSupply": "1.0342879e-11",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "period": 604800n,
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "roundedTimestamp": "2024-07-21T00:00:00.000Z",
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                        },
                      ],
                    },
                    "ClmStrategy": {
                      "sets": [
                        {
                          "address": "0x51582dcef28aea484dd87933324a55482882ce17",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": "2024-07-23T00:24:27.000Z",
                          "pausableStatus": "RUNNING",
                        },
                      ],
                    },
                    "Token": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "isVirtual": false,
                          "name": "Cow Sushi Base WETH-USDC",
                          "symbol": "cowSushiBaseWETH-USDC",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x4200000000000000000000000000000000000006",
                          "chainId": 8453,
                          "decimals": 18,
                          "holderCount": 0,
                          "id": "8453-0x4200000000000000000000000000000000000006",
                          "isVirtual": false,
                          "name": "Wrapped Ether",
                          "symbol": "WETH",
                          "totalSupply": "0",
                        },
                        {
                          "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                          "chainId": 8453,
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
                    "block": 17452460,
                    "chainId": 8453,
                    "eventsProcessed": 2,
                  },
                  {
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": "2024-07-23T00:24:27.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "1.0342879e-11",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "PAUSED",
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                          "underlyingProtocolPool": "0x57713f7716e0b0f65ec116912f834e49805480d2",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "block": 17452461,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                  {
                    "Clm": {
                      "sets": [
                        {
                          "address": "0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "chainId": 8453,
                          "clmManager_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "clmStrategy_id": "8453-0x51582dcef28aea484dd87933324a55482882ce17",
                          "id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "initializableStatus": "INITIALIZED",
                          "initializedBlock": 17452460n,
                          "initializedTimestamp": "2024-07-23T00:24:27.000Z",
                          "managerToken_id": "8453-0x603492ff8943f5ac69aa69cf09fc96fda2606ee7",
                          "managerTotalSupply": "1.0342879e-11",
                          "nativeToUSDPrice": "3446.16476685",
                          "outputToNativePrices": [],
                          "outputToken_ids": [],
                          "outputTokensOrder": [],
                          "pausableStatus": "RUNNING",
                          "priceOfToken0InToken1": "3447.477622",
                          "priceRangeMax1": "3695.946291",
                          "priceRangeMin1": "3213.123836",
                          "rewardPoolToken_ids": [],
                          "rewardPoolTokensOrder": [],
                          "rewardPoolsTotalSupply": [],
                          "rewardToNativePrices": [],
                          "rewardToken_ids": [],
                          "rewardTokensOrder": [],
                          "token0ToNativePrice": "1",
                          "token1ToNativePrice": "0.000290180547842",
                          "totalBeefyFees": "0",
                          "totalCallFees": "0",
                          "totalStrategistFees": "0",
                          "totalUnderlyingAmount0": "0.001499999999999999",
                          "totalUnderlyingAmount1": "5.171662",
                          "underlyingAltAmount0": "0",
                          "underlyingAltAmount1": "0",
                          "underlyingMainAmount0": "0.001483263487967805",
                          "underlyingMainAmount1": "5.171662",
                          "underlyingProtocolPool": "0x57713f7716e0b0f65ec116912f834e49805480d2",
                          "underlyingToken0_id": "8453-0x4200000000000000000000000000000000000006",
                          "underlyingToken1_id": "8453-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                        },
                      ],
                    },
                    "block": 17452462,
                    "chainId": 8453,
                    "eventsProcessed": 1,
                  },
                ],
              }
            `);
        });
    });
});
