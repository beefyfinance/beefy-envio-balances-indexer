import { describe, expect, it } from 'vitest';

import { CLOUDFLARE_RANGES, inRanges, parseCidr, resolveClientIp } from './clientIp.ts';

const cloudflare = CLOUDFLARE_RANGES.map(parseCidr);

describe('client ip', () => {
    it('matches IPv4 and IPv6 ranges, including mapped addresses', () => {
        expect(inRanges('104.16.0.1', cloudflare)).toBe(true);
        expect(inRanges('104.15.255.255', cloudflare)).toBe(false);
        expect(inRanges('::ffff:173.245.48.9', cloudflare)).toBe(true);
        expect(inRanges('2606:4700::1', cloudflare)).toBe(true);
        expect(inRanges('2606:4701::1', cloudflare)).toBe(false);
        expect(inRanges('not an ip', cloudflare)).toBe(false);
    });

    it('rejects malformed ranges', () => {
        expect(() => parseCidr('10.0.0.0/33')).toThrow('invalid CIDR');
        expect(() => parseCidr('nope/8')).toThrow('invalid CIDR');
    });

    it('believes CF-Connecting-IP only when the hop is Cloudflare', () => {
        expect(resolveClientIp({ socketIp: '104.16.0.1', connectingIpHeader: '203.0.113.7', cloudflare })).toBe(
            '203.0.113.7'
        );
        expect(resolveClientIp({ socketIp: '198.51.100.9', connectingIpHeader: '203.0.113.7', cloudflare })).toBe(
            '198.51.100.9'
        );
        expect(resolveClientIp({ socketIp: '104.16.0.1', connectingIpHeader: 'garbage', cloudflare })).toBe(
            '104.16.0.1'
        );
        expect(
            resolveClientIp({ socketIp: '104.16.0.1', connectingIpHeader: '203.0.113.7', cloudflare: undefined })
        ).toBe('104.16.0.1');
    });
});
