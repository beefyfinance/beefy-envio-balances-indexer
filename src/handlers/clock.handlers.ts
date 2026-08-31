import { type EvmOnEventContext, indexer } from 'envio';
import { getBlockTimestamp } from '../effects/block.effects';
import { fetchClassicState, parseFetchedClassicState } from '../effects/classic.effects';
import { fetchClmState, parseFetchedClmState } from '../effects/clm.effects';
import { isClassicInitialized } from '../entities/classic.entity';
import { isClmInitialized } from '../entities/clm.entity';
import { toChainId } from '../lib/chain';
import { refreshClassicSnapshot } from '../lib/classic/refresh';
import { buildClassicFetchInput, loadClassicTokens } from '../lib/classic/tokens';
import { refreshClmSnapshot } from '../lib/clm/refresh';
import { buildClmFetchInput, loadClmTokens } from '../lib/clm/tokens';
import { BIG_ZERO } from '../lib/decimal';
import { getOrCreateClockTick } from '../lib/snapshot/tick';
import { getApproxBlocksPerHour, HOUR } from '../lib/time/interval';

// Envio's test indexer replays onBlock handlers from chain start to each simulated
// event block. HourlyClockTick would trigger thousands of RPC calls during unit
// tests, so skip registration under vitest.
if (process.env.VITEST !== 'true') {
    indexer.onBlock(
        {
            name: 'HourlyClockTick',
            where: ({ chain }) => ({
                block: {
                    number: {
                        _gte: chain.startBlock,
                        _every: getApproxBlocksPerHour(chain.id),
                    },
                },
            }),
        },
        async ({ block, context }) => {
            const chainId = toChainId(context.chain.id);
            const { timestamp } = await context.effect(getBlockTimestamp, {
                chainId,
                blockNumber: block.number,
            });

            const { isNew } = await getOrCreateClockTick({
                context,
                chainId,
                timestamp,
                period: HOUR,
            });

            if (!isNew) {
                return;
            }

            const clms = await context.Clm.getWhere({
                initializableStatus: { _eq: 'INITIALIZED' },
                managerTotalSupply: { _gt: BIG_ZERO },
            });
            const classics = await context.Classic.getWhere({
                initializableStatus: { _eq: 'INITIALIZED' },
                vaultTokenTotalSupply: { _gt: BIG_ZERO },
            });

            await refreshClmSnapshotsOnTick({ context, chainId, timestamp, blockNumber: block.number, clms });
            await refreshClassicSnapshotsOnTick({
                context,
                chainId,
                timestamp,
                blockNumber: block.number,
                classics,
            });
        }
    );
}

const refreshClmSnapshotsOnTick = async ({
    context,
    chainId,
    timestamp,
    blockNumber,
    clms,
}: {
    context: Parameters<typeof refreshClmSnapshot>[0]['context'];
    chainId: ReturnType<typeof toChainId>;
    timestamp: number;
    blockNumber: number;
    clms: Awaited<ReturnType<EvmOnEventContext['Clm']['getWhere']>>;
}) => {
    for (const clm of clms) {
        if (!isClmInitialized(clm)) continue;

        const tokens = await loadClmTokens({ context, clm });
        const fetchInput = buildClmFetchInput({ clm, tokens, chainId, blockNumber });
        const rawState = await context.effect(fetchClmState, fetchInput);
        const state = parseFetchedClmState(rawState, tokens);

        await refreshClmSnapshot({ context, clm, state, timestamp });
    }
};

const refreshClassicSnapshotsOnTick = async ({
    context,
    chainId,
    timestamp,
    blockNumber,
    classics,
}: {
    context: Parameters<typeof refreshClassicSnapshot>[0]['context'];
    chainId: ReturnType<typeof toChainId>;
    timestamp: number;
    blockNumber: number;
    classics: Awaited<ReturnType<EvmOnEventContext['Classic']['getWhere']>>;
}) => {
    for (const classic of classics) {
        if (!isClassicInitialized(classic)) continue;

        const tokens = await loadClassicTokens({ context, classic });
        const fetchInput = await buildClassicFetchInput({ context, chainId, classic, tokens, blockNumber });
        const rawState = await context.effect(fetchClassicState, fetchInput);
        const state = parseFetchedClassicState(rawState, tokens);

        await refreshClassicSnapshot({ context, classic, state, timestamp });
    }
};
