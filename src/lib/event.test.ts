import { describe, expect, it } from 'vitest';
import { eventId, getEventFields } from './event';

describe('event', () => {
    const chainId = 8453;
    const trxHash = '0x5a4fbda772ea9a1754da8fff90de60da9fb2acb06432ea0c9a7cd8719c05443d';
    const trxIndex = 6;
    const logIndex = 22;
    const block = { number: 17_452_460, timestamp: 1721694267 };

    it('Should build stable event id from chain, tx, and log metadata', () => {
        expect(eventId({ chainId, trxHash, trxIndex, logIndex })).toBe(
            '8453-0x5a4fbda772ea9a1754da8fff90de60da9fb2acb06432ea0c9a7cd8719c05443d-6-22'
        );
    });

    it('Should normalize checksum addresses in trx hash', () => {
        const upper = '0x5A4FBDA772EA9A1754DA8FFF90DE60DA9FB2ACB06432EA0C9A7CD8719C05443D';
        expect(eventId({ chainId, trxHash: upper, trxIndex, logIndex })).toBe(
            eventId({ chainId, trxHash, trxIndex, logIndex })
        );
    });

    it('Should produce getEventFields matching entity event id format', () => {
        const fields = getEventFields({
            chainId,
            event: { block, trxHash, trxIndex, logIndex },
        });
        expect(fields.id).toBe('8453-0x5a4fbda772ea9a1754da8fff90de60da9fb2acb06432ea0c9a7cd8719c05443d-6-22');
        expect(fields.trxHash).toBe(trxHash);
        expect(fields.trxIndex).toBe(6);
        expect(fields.logIndex).toBe(22);
        expect(fields.blockNumber).toBe(17_452_460n);
        expect(fields.blockTimestamp).toEqual(new Date(1721694267 * 1000));
    });
});
