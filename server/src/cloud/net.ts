import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError } from '../services/vouchers.js';

export function ipv4ToInt(ip: string): number | undefined {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function intToIpv4(n: number) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export interface Cidr {
  base: number;
  bits: number;
  first: number;
  last: number;
}

export function parseCidr(cidr: string): Cidr {
  const [ip, b] = cidr.trim().split('/');
  const base = ipv4ToInt(ip ?? '');
  const bits = Number(b);
  if (base === undefined || !Number.isInteger(bits) || bits < 8 || bits > 30) throw new Error(`Jaringan tunnel tidak valid: ${cidr} (contoh 10.200.0.0/16)`);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const first = (base & mask) >>> 0;
  return { base: first, bits, first, last: (first | (~mask >>> 0)) >>> 0 };
}

export function cidrContains(c: Cidr, ip: string) {
  const n = ipv4ToInt(ip);
  return n !== undefined && n >= c.first && n <= c.last;
}

/** IP tunnel milik CHR/server: alamat pertama yang bisa dipakai di jaringan tunnel. */
export function serverTunnelIp(network: string) {
  return intToIpv4(parseCidr(network).first + 1);
}

/** IP tunnel berikutnya yang kosong. Dimulai dari blok kedua (x.x.1.1) agar x.x.0.x tetap untuk server. */
export function allocateTunnelIp(network: string, used: Iterable<string>): string {
  const c = parseCidr(network);
  const taken = new Set(used);
  const start = c.bits <= 23 ? c.first + 256 + 1 : c.first + 2;
  for (let n = start; n < c.last; n++) {
    const last = n & 255;
    if (last === 0 || last === 255) continue;
    const ip = intToIpv4(n);
    if (!taken.has(ip)) return ip;
  }
  throw new HttpError(503, 'IP tunnel VPN habis. Hubungi admin MIKROTAL Cloud.');
}

/** Alamat yang tidak boleh dijangkau dari aplikasi pelanggan (jaringan internal server, loopback, dsb). */
const blocked = new net.BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as [string, number][])
  blocked.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as [string, number][])
  blocked.addSubnet(ip, bits, 'ipv6');

export function isPublicAddress(ip: string) {
  // IPv4 dalam bentuk IPv6 (::ffff:10.0.0.1) diperiksa sebagai IPv4
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];
  const family = net.isIP(ip);
  if (!family) return false;
  return !blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Aturan alamat router di MIKROTAL Cloud. Aplikasi pelanggan hanya boleh tersambung ke:
 *  - IP tunnel VPN milik pelanggan itu sendiri, atau
 *  - IP publik (langsung, atau nama domain/DDNS yang mengarah ke IP publik).
 * Nama domain di-resolve setiap kali tersambung, dan alamat hasil resolve itulah yang dipakai,
 * sehingga DNS tidak bisa diarahkan ulang ke jaringan internal server.
 */
export async function resolveAllowedHost(host: string, ownTunnelIps: () => Iterable<string>): Promise<string> {
  const h = host.trim().replace(/^\[|\]$/g, '');
  const own = new Set(ownTunnelIps());
  if (own.has(h)) return h;
  let addresses: string[];
  if (net.isIP(h)) addresses = [h];
  else {
    if (!/^[a-z0-9.-]+$/i.test(h) || !h.includes('.')) throw new HttpError(400, `Alamat router "${host}" tidak valid`);
    try {
      addresses = (await dns.lookup(h, { all: true })).map((a) => a.address);
    } catch {
      throw new HttpError(400, `Nama domain ${host} tidak ditemukan`);
    }
  }
  const ok = addresses.find((a) => own.has(a) || isPublicAddress(a));
  if (!ok) {
    throw new HttpError(
      400,
      `Alamat ${host} tidak bisa dijangkau dari MIKROTAL Cloud. Hubungkan router lewat menu Langganan & VPN (dapat IP tunnel), atau gunakan IP publik router.`,
    );
  }
  return ok;
}
