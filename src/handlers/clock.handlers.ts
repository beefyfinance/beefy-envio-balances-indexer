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
import { HOUR } from '../lib/time/interval';

indexer.onBlock({ name: 'HourlyClockTick' }, async ({ block, context }) => {
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
});

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

    const fetchInputs = await Promise.all(
        clms.map(async (clm) => {
            const tokens = await loadClmTokens({ context, clm });
            return buildClmFetchInput({ clm, tokens, blockNumber });
        })
    );

    const { states } = await context.effect(fetchClmStates, { requests: fetchInputs });

    for (let i = 0; i < clms.length; i++) {
        const clm = clms[i];
        const rawState = states[i];
        if (!clm || !rawState || !isClmInitialized(clm)) {
            continue;
        }

        const tokenContext = await loadClmTokens({ context, clm });
        const state = parseFetchedClmState(rawState, tokenContext);

        await refreshClmSnapshot({
            context,
            clm,
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

    const fetchInputs = await Promise.all(
        classics.map(async (classic) => {
            const tokens = await loadClassicTokens({ context, classic });
            return buildClassicFetchInput({ context, chainId, classic, tokens, blockNumber });
        })
    );

    const { states } = await context.effect(fetchClassicStates, { requests: fetchInputs });

    for (let i = 0; i < classics.length; i++) {
        const classic = classics[i];
        const rawState = states[i];
        if (!classic || !rawState || !isClassicInitialized(classic)) {
            continue;
        }

        const tokenContext = await loadClassicTokens({ context, classic });
        const state = parseFetchedClassicState(rawState, tokenContext);

        await refreshClassicSnapshot({
            context,
            classic,
            state,
            timestamp,
        });
    }
};
