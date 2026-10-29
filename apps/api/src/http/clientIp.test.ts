import { describe, expect, it } from 'vitest';

import { clientKey, cloudflareRanges, inRanges, parseCidr, resolveClientIp } from './clientIp.ts';

const cloudflare = cloudflareRanges().map(parseCidr);

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

    const resolve = (overrides: Partial<Parameters<typeof resolveClientIp>[0]>) =>
        resolveClientIp({
            source: 'cloudflare',
            socketIp: '104.16.0.1',
            forwardedFor: undefined,
            connectingIp: '203.0.113.7',
            cloudflare,
            ...overrides,
        });

    it('believes CF-Connecting-IP only when the hop is Cloudflare', () => {
        expect(resolve({})).toBe('203.0.113.7');
        expect(resolve({ socketIp: '198.51.100.9' })).toBe('198.51.100.9');
        expect(resolve({ connectingIp: 'garbage' })).toBe('104.16.0.1');
        expect(resolve({ source: 'socket' })).toBe('104.16.0.1');
    });

    it('behind Heroku, takes the hop from the last X-Forwarded-For entry, never an earlier one', () => {
        const heroku = { source: 'heroku-cloudflare', socketIp: '10.1.2.3' } as const;
        // Cloudflare reached the router: its CF-Connecting-IP is the client
        expect(resolve({ ...heroku, forwardedFor: '203.0.113.7, 104.16.0.1' })).toBe('203.0.113.7');
        // the Heroku hostname reached directly: a forged CF-Connecting-IP and forged earlier entries are ignored
        expect(resolve({ ...heroku, forwardedFor: '104.16.0.1, 198.51.100.9', connectingIp: '1.1.1.1' })).toBe(
            '198.51.100.9'
        );
        // no usable header: the socket
        expect(resolve({ ...heroku, forwardedFor: 'garbage' })).toBe('10.1.2.3');
        expect(resolve({ ...heroku, forwardedFor: undefined })).toBe('10.1.2.3');
    });

    it('keys IPv4 by address and IPv6 by /64', () => {
        expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
        expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
        expect(clientKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
        expect(clientKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
        expect(clientKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
        expect(clientKey('unknown')).toBe('unknown');
    });
});
