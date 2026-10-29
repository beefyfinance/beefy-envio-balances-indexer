import { isIP } from 'node:net';

/** Published by Cloudflare at https://www.cloudflare.com/ips (checked 2026-10); update by hand when they change. */
const CLOUDFLARE_RANGES = [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32',
];

/** Cloudflare's address ranges, whose `CF-Connecting-IP` is believed. */
export const cloudflareRanges = (): string[] => [...CLOUDFLARE_RANGES];

const ipv6ToBigInt = (address: string): bigint | undefined => {
    const withoutZone = address.split('%')[0] ?? address;
    // an IPv4-mapped address (::ffff:1.2.3.4) is handled by the caller
    const [head, tail, extra] = withoutZone.split('::');
    if (extra !== undefined) return undefined;
    const part = (text: string | undefined): string[] => (text === undefined || text === '' ? [] : text.split(':'));
    const left = part(head);
    const right = tail === undefined ? [] : part(tail);
    const missing = 8 - left.length - right.length;
    if (tail === undefined ? left.length !== 8 : missing < 1) return undefined;
    const groups = [...left, ...Array.from({ length: tail === undefined ? 0 : missing }, () => '0'), ...right];
    let value = 0n;
    for (const group of groups) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
        value = (value << 16n) | BigInt(`0x${group}`);
    }
    return value;
};

const ipv4ToBigInt = (address: string): bigint | undefined => {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        return undefined;
    }
    return octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
};

const toBigInt = (address: string): { value: bigint; bits: 32 | 128 } | undefined => {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    const text = mapped?.[1] ?? address;
    const family = isIP(text);
    if (family === 4) {
        const value = ipv4ToBigInt(text);
        return value === undefined ? undefined : { value, bits: 32 };
    }
    if (family === 6) {
        const value = ipv6ToBigInt(text);
        return value === undefined ? undefined : { value, bits: 128 };
    }
    return undefined;
};

export type Cidr = { network: bigint; bits: 32 | 128; prefix: number };

export const parseCidr = (cidr: string): Cidr => {
    const [address, prefixText] = cidr.split('/');
    const parsed = address === undefined ? undefined : toBigInt(address);
    const prefix = Number(prefixText);
    if (parsed === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > parsed.bits) {
        throw new Error(`invalid CIDR: ${cidr}`);
    }
    const hostBits = BigInt(parsed.bits - prefix);
    return { network: (parsed.value >> hostBits) << hostBits, bits: parsed.bits, prefix };
};

export const inRanges = (address: string, ranges: readonly Cidr[]): boolean => {
    const parsed = toBigInt(address);
    if (parsed === undefined) return false;
    return ranges.some(({ network, bits, prefix }) => {
        if (bits !== parsed.bits) return false;
        const hostBits = BigInt(bits - prefix);
        return (parsed.value >> hostBits) << hostBits === network;
    });
};

/** Where the address of the client comes from, behind which proxies (`CLIENT_IP`). */
export type ClientIpSource = 'socket' | 'cloudflare' | 'heroku-cloudflare';

/** The last `X-Forwarded-For` entry: the one appended by the proxy in front of us, the only one it vouches for. */
const lastForwardedHop = (header: string | undefined): string | undefined => {
    const hop = header?.split(',').at(-1)?.trim();
    return hop !== undefined && isIP(hop) !== 0 ? hop : undefined;
};

/**
 * The address of the client. `CF-Connecting-IP` is believed only when the hop that reached us is inside Cloudflare's
 * ranges (anyone else can write that header); otherwise that hop is the client.
 *
 * - `socket`: the hop is the socket peer.
 * - `cloudflare`: Cloudflare connects to us directly, so the hop is the socket peer.
 * - `heroku-cloudflare`: Cloudflare, then Heroku's router. The socket is the router; the router appends the address it
 *   was reached from to `X-Forwarded-For`, so the last entry is the hop (Cloudflare, or a client reaching the Heroku
 *   hostname directly). Earlier entries are whatever the client sent and are never read.
 */
export const resolveClientIp = ({
    source,
    socketIp,
    forwardedFor,
    connectingIp,
    cloudflare,
}: {
    source: ClientIpSource;
    socketIp: string;
    forwardedFor: string | undefined;
    connectingIp: string | undefined;
    cloudflare: readonly Cidr[];
}): string => {
    const hop = source === 'heroku-cloudflare' ? (lastForwardedHop(forwardedFor) ?? socketIp) : socketIp;
    if (source !== 'socket' && connectingIp !== undefined && inRanges(hop, cloudflare)) {
        const candidate = connectingIp.trim();
        if (isIP(candidate) !== 0) return candidate.toLowerCase();
    }
    return hop.toLowerCase();
};

/**
 * The rate limit key of an address: IPv4 as is (IPv4-mapped IPv6 included), IPv6 by its /64, the smallest block a
 * single host or customer is usually given (one host can pick any address in it).
 */
export const clientKey = (address: string): string => {
    const parsed = toBigInt(address);
    if (parsed === undefined) return address;
    if (parsed.bits === 32) return /^::ffff:/i.test(address) ? address.slice(7) : address;
    const prefix = parsed.value >> 64n;
    const groups = [48n, 32n, 16n, 0n].map((shift) => ((prefix >> shift) & 0xffffn).toString(16));
    return `${groups.join(':')}::/64`;
};
