import { indexer } from 'envio';
import { getBlockTimestamp } from '../effects/block.effects';
import { fetchClassicStates, parseFetchedClassicState } from '../effects/classic.effects';
import { fetchClmStates, parseFetchedClmState } from '../effects/clm.effects';
import { isClassicInitialized } from '../entities/classic.entity';
import { isClmInitialized } from '../entities/clm.entity';
import { toChainId } from '../lib/chain';
import { refreshClassicSnapshot } from '../lib/classic/refresh';
import { buildClassicFetchInput, loadClassicTokens } from '../lib/classic/tokens';
import { refreshClmSnapshot } from '../lib/clm/refresh';
import { buildClmFetchInput, loadClmTokens } from '../lib/clm/tokens';
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

            await refreshClmSnapshotsOnTick({ context, chainId, timestamp, blockNumber: block.number });
            await refreshClassicSnapshotsOnTick({ context, chainId, timestamp, blockNumber: block.number });
        }
    );
}

const refreshClmSnapshotsOnTick = async ({
    context,
    chainId,
    timestamp,
    blockNumber,
}: {
    context: Parameters<typeof refreshClmSnapshot>[0]['context'];
    chainId: ReturnType<typeof toChainId>;
    timestamp: number;
    blockNumber: number;
}) => {
    const clms = await context.Clm.getWhere({
        chainId: { _eq: chainId },
        initializableStatus: { _eq: 'INITIALIZED' },
    });

    if (clms.length === 0) {
        return;
    }

    const loaded = await Promise.all(
        clms.map(async (clm) => {
            const tokens = await loadClmTokens({ context, clm });
            return { clm, tokens, fetchInput: buildClmFetchInput({ clm, tokens, blockNumber }) };
        })
    );

    const { states } = await context.effect(fetchClmStates, { requests: loaded.map((entry) => entry.fetchInput) });

    for (let i = 0; i < loaded.length; i++) {
        const entry = loaded[i];
        const rawState = states[i];
        if (!entry || !rawState || !isClmInitialized(entry.clm)) {
            continue;
        }

        const state = parseFetchedClmState(rawState, entry.tokens);

        await refreshClmSnapshot({
            context,
            clm: entry.clm,
            state,
            timestamp,
        });
    }
};

const refreshClassicSnapshotsOnTick = async ({
    context,
    chainId,
    timestamp,
    blockNumber,
}: {
    context: Parameters<typeof refreshClassicSnapshot>[0]['context'];
    chainId: ReturnType<typeof toChainId>;
    timestamp: number;
    blockNumber: number;
}) => {
    const classics = await context.Classic.getWhere({
        chainId: { _eq: chainId },
        initializableStatus: { _eq: 'INITIALIZED' },
    });

    if (classics.length === 0) {
        return;
    }

    const loaded = await Promise.all(
        classics.map(async (classic) => {
            const tokens = await loadClassicTokens({ context, classic });
            return {
                classic,
                tokens,
                fetchInput: await buildClassicFetchInput({ context, chainId, classic, tokens, blockNumber }),
            };
        })
    );

    const { states } = await context.effect(fetchClassicStates, { requests: loaded.map((entry) => entry.fetchInput) });

    for (let i = 0; i < loaded.length; i++) {
        const entry = loaded[i];
        const rawState = states[i];
        if (!entry || !rawState || !isClassicInitialized(entry.classic)) {
            continue;
        }

        const state = parseFetchedClassicState(rawState, entry.tokens);

        await refreshClassicSnapshot({
            context,
            classic: entry.classic,
            state,
            timestamp,
        });
    }
};
