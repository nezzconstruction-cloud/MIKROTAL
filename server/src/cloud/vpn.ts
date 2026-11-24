import crypto from 'node:crypto';
import { parseDuration } from '../lib/duration.js';
import { RouterOSClient } from '../lib/routeros/client.js';
import { SimulatedRouter } from '../lib/routeros/simulator.js';
import { ConnectionError, type RosParams, type RosRow, type RouterConnection } from '../lib/routeros/types.js';
import { HttpError } from '../services/vouchers.js';
import { allocateTunnelIp, parseCidr, serverTunnelIp } from './net.js';
import type { Platform, TenantRow } from './platform.js';
import type { ChrSettings } from './settings.js';

export type VpnKind = 'wireguard' | 'l2tp' | 'sstp';
export const VPN_KINDS: VpnKind[] = ['wireguard', 'l2tp', 'sstp'];

export interface VpnPeerRow {
  id: number;
  tenant_id: number;
  name: string;
  kind: VpnKind;
  tunnel_ip: string;
  ppp_user: string;
  ppp_secret_enc: string;
  wg_private_enc: string;
  wg_public: string;
  wg_listen_port: number;
  api_user: string;
  api_password_enc: string;
  router_id: number | null;
  last_seen_at: string | null;
  created_at: string;
}

/** Komentar penanda semua konfigurasi yang dibuat skrip di router pelanggan (dipakai untuk membersihkan saat dipasang ulang). */
export const ROUTER_TAG = 'MIKROTAL Cloud';
const IFACE = 'mikrotal-cloud';
/** Handshake WireGuard terakhir lebih lama dari ini = dianggap tidak tersambung. */
const WG_ONLINE_SECONDS = 180;

export function wgKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const raw = (k: crypto.KeyObject, f: 'd' | 'x') => Buffer.from(String(k.export({ format: 'jwk' })[f]), 'base64url').toString('base64');
  return { privateKey: raw(privateKey, 'd'), publicKey: raw(publicKey, 'x') };
}

/** Teks acak huruf+angka saja, agar aman ditaruh di skrip RouterOS tanpa escape. */
export function randomToken(len: number) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

export const peerComment = (slug: string, peerId: number) => `mikrotal:${slug}:${peerId}`;

export interface ScriptInput {
  kind: VpnKind;
  routerName: string;
  tunnelIp: string;
  serverIp: string;
  endpoint: string;
  apiUser: string;
  apiPassword: string;
  wg?: { privateKey: string; listenPort: number; serverPublicKey: string; serverPort: number };
  ppp?: { user: string; secret: string; ipsecSecret?: string; sstpPort?: number };
}

/**
 * Skrip yang ditempel pelanggan ke Terminal router (Winbox/WebFig). Seluruhnya satu blok `{ ... }`,
 * aman dijalankan ulang (konfigurasi lama berkomentar "MIKROTAL Cloud" dihapus dulu), dan hanya menyebut
 * menu yang ada di versi RouterOS-nya (skrip v6 tidak menyebut WireGuard).
 */
export function routerScript(i: ScriptInput): string {
  const tag = `comment="${ROUTER_TAG}"`;
  const head = [
    `# ===== ${ROUTER_TAG}: hubungkan router "${i.routerName.replace(/["\\$]/g, '')}" =====`,
    i.kind === 'wireguard' ? '# Untuk RouterOS v7 (WireGuard).' : i.kind === 'l2tp' ? '# Untuk RouterOS v6 dan v7 (L2TP/IPsec).' : '# Untuk RouterOS v6 dan v7 (SSTP lewat port TCP, cocok bila L2TP diblokir ISP).',
    '# Tempel SELURUH teks ini ke New Terminal di Winbox/WebFig, lalu tekan Enter.',
    '# Aman dijalankan ulang. Yang dibuat: 1 interface VPN, 1 alamat IP tunnel, 1 rule firewall, 1 user API.',
  ];
  const clean = [
    `/user remove [find ${tag}]`,
    `/ip firewall filter remove [find ${tag}]`,
    `/ip address remove [find ${tag}]`,
  ];
  let iface: string[];
  if (i.kind === 'wireguard') {
    if (!i.wg) throw new Error('data WireGuard kosong');
    clean.push(`/interface wireguard peers remove [find ${tag}]`, `/interface wireguard remove [find ${tag}]`);
    iface = [
      `/interface wireguard add name=${IFACE} private-key="${i.wg.privateKey}" listen-port=${i.wg.listenPort} ${tag}`,
      `/interface wireguard peers add interface=${IFACE} public-key="${i.wg.serverPublicKey}" endpoint-address=${i.endpoint} endpoint-port=${i.wg.serverPort} allowed-address=${i.serverIp}/32 persistent-keepalive=25s ${tag}`,
      `/ip address add address=${i.tunnelIp} network=${i.serverIp} interface=${IFACE} ${tag}`,
    ];
  } else if (i.kind === 'l2tp') {
    if (!i.ppp?.ipsecSecret) throw new Error('data L2TP kosong');
    clean.push(`/interface l2tp-client remove [find ${tag}]`);
    iface = [
      `/interface l2tp-client add name=${IFACE} connect-to=${i.endpoint} user="${i.ppp.user}" password="${i.ppp.secret}" use-ipsec=yes ipsec-secret="${i.ppp.ipsecSecret}" allow=mschap2 add-default-route=no disabled=no ${tag}`,
    ];
  } else {
    if (!i.ppp) throw new Error('data SSTP kosong');
    clean.push(`/interface sstp-client remove [find ${tag}]`);
    iface = [
      `/interface sstp-client add name=${IFACE} connect-to=${i.endpoint} port=${i.ppp.sstpPort ?? 443} user="${i.ppp.user}" password="${i.ppp.secret}" authentication=mschap2 verify-server-certificate=no add-default-route=no disabled=no ${tag}`,
    ];
  }
  const rule = `chain=input in-interface=${IFACE} src-address=${i.serverIp} action=accept ${tag}`;
  const access = [
    '# Izinkan MIKROTAL Cloud mengakses API router lewat tunnel saja',
    `:local fw [/ip firewall filter find dynamic=no]`,
    `:if ([:len $fw] > 0) do={ /ip firewall filter add ${rule} place-before=[:pick $fw 0] } else={ /ip firewall filter add ${rule} }`,
    `/ip service set [find name=api] disabled=no`,
    `:local apiAddr [/ip service get [find name=api] address]`,
    `:if ([:len $apiAddr] > 0 && [:len [:find [:tostr $apiAddr] "${i.serverIp}"]] = 0) do={ /ip service set [find name=api] address=($apiAddr, "${i.serverIp}/32") }`,
    `/user add name=${i.apiUser} group=full password="${i.apiPassword}" address=${i.serverIp}/32 ${tag}`,
  ];
  const body = [...clean, ...iface, ...access, `:log info "${ROUTER_TAG}: router terhubung ke ${i.tunnelIp}"`, `:put "${ROUTER_TAG}: selesai. Kembali ke MIKROTAL, status router akan berubah menjadi online dalam 1 menit."`];
  return [...head, '{', ...body.map((l) => (l.startsWith('#') ? `  ${l}` : `  ${l}`)), '}', ''].join('\n');
}

export class VpnService {
  private conn?: RouterConnection;
  private connecting?: Promise<RouterConnection>;

  constructor(private readonly platform: Platform) {}

  private get chrSettings(): ChrSettings {
    return this.platform.settings.get().chr;
  }

  /** Apa saja yang belum diatur admin untuk setiap jenis VPN. */
  readiness() {
    const c = this.chrSettings;
    const base: string[] = [];
    if (!c.host && !c.simulate) base.push('Alamat API CHR');
    if (!c.endpoint) base.push('Alamat publik VPN (endpoint)');
    try {
      parseCidr(c.tunnelNetwork);
    } catch {
      base.push('Jaringan tunnel');
    }
    const kinds: Record<VpnKind, string[]> = {
      wireguard: [...base, ...(c.wgPublicKey ? [] : ['Public key WireGuard CHR (jalankan "Siapkan CHR")'])],
      l2tp: [...base, ...(c.ipsecSecretEnc ? [] : ['IPsec secret L2TP (jalankan "Siapkan CHR")'])],
      sstp: base,
    };
    return { kinds, available: VPN_KINDS.filter((k) => !kinds[k].length) };
  }

  resetConnection() {
    this.conn?.close();
    this.conn = undefined;
  }

  private async connection(): Promise<RouterConnection> {
    if (this.conn?.connected) return this.conn;
    if (this.connecting) return this.connecting;
    const c = this.chrSettings;
    if (!c.host && !c.simulate) throw new HttpError(503, 'Server VPN (CHR) belum diatur admin MIKROTAL Cloud');
    const conn: RouterConnection = c.simulate
      ? new SimulatedRouter('platform-chr', 'MIKROTAL-CHR', { username: c.username })
      : new RouterOSClient({ host: c.host, port: c.port, username: c.username, password: this.platform.box.decrypt(c.passwordEnc), tls: c.tls, timeoutMs: 10000 });
    this.connecting = (async () => {
      try {
        await conn.connect();
      } catch (err) {
        throw new HttpError(502, `Tidak bisa tersambung ke server VPN (CHR): ${(err as Error).message}`);
      }
      conn.on('close', () => {
        if (this.conn === conn) this.conn = undefined;
      });
      this.conn = conn;
      return conn;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async exec(command: string, params?: RosParams, queries?: string[]): Promise<RosRow[]> {
    let conn = await this.connection();
    try {
      return await conn.exec(command, params, queries);
    } catch (err) {
      if (err instanceof ConnectionError && !conn.connected) {
        this.resetConnection();
        conn = await this.connection();
        return conn.exec(command, params, queries);
      }
      throw err;
    }
  }

  /**
   * Siapkan CHR sebagai pusat VPN (bisa dijalankan ulang): interface WireGuard + IP server tunnel,
   * profil PPP, server L2TP/IPsec dan SSTP, isolasi antar pelanggan, dan src-nat dari server MIKROTAL.
   */
  async setupChr() {
    const c = this.chrSettings;
    const net = parseCidr(c.tunnelNetwork);
    const serverIp = serverTunnelIp(c.tunnelNetwork);
    const steps: { step: string; ok: boolean; detail?: string }[] = [];
    const step = async (name: string, fn: () => Promise<string | void>) => {
      try {
        const detail = await fn();
        steps.push({ step: name, ok: true, detail: detail || undefined });
      } catch (err) {
        steps.push({ step: name, ok: false, detail: (err as Error).message });
      }
    };
    const tag = 'mikrotal-cloud';
    const [res] = await this.exec('/system/resource/print');
    const v7 = /^7\./.test(res?.version ?? '');
    const patch: Partial<ChrSettings> = {};

    if (v7) {
      await step('Interface WireGuard', async () => {
        let [wg] = await this.exec('/interface/wireguard/print', {}, [`?name=${c.wgInterface}`]);
        if (!wg) {
          await this.exec('/interface/wireguard/add', { name: c.wgInterface, 'listen-port': String(c.wgPort), comment: tag });
          [wg] = await this.exec('/interface/wireguard/print', {}, [`?name=${c.wgInterface}`]);
        }
        if (!wg?.['public-key']) throw new Error('public key tidak terbaca');
        patch.wgPublicKey = wg['public-key'];
        patch.wgPort = Number(wg['listen-port'] ?? c.wgPort);
        return `port ${patch.wgPort}`;
      });
      await step(`IP server tunnel ${serverIp}`, async () => {
        const has = (await this.exec('/ip/address/print')).some((a) => a.address?.startsWith(`${serverIp}/`));
        if (!has) await this.exec('/ip/address/add', { address: `${serverIp}/${net.bits}`, interface: c.wgInterface, comment: tag });
      });
    } else {
      steps.push({ step: 'Interface WireGuard', ok: false, detail: `CHR RouterOS ${res?.version ?? '?'} belum mendukung WireGuard (butuh v7)` });
    }

    await step('Profil PPP', async () => {
      const [p] = await this.exec('/ppp/profile/print', {}, [`?name=${c.pppProfile}`]);
      const params = { 'local-address': serverIp, 'only-one': 'yes', 'use-encryption': 'yes', 'change-tcp-mss': 'yes', comment: tag };
      if (p) await this.exec('/ppp/profile/set', { '.id': p['.id'], ...params });
      else await this.exec('/ppp/profile/add', { name: c.pppProfile, ...params });
    });

    await step('Server L2TP/IPsec', async () => {
      let secret = c.ipsecSecretEnc ? this.platform.box.decrypt(c.ipsecSecretEnc) : '';
      if (!secret) {
        secret = randomToken(24);
        patch.ipsecSecretEnc = this.platform.box.encrypt(secret);
      }
      await this.exec('/interface/l2tp-server/server/set', { enabled: 'yes', 'use-ipsec': 'required', 'ipsec-secret': secret, 'default-profile': c.pppProfile, authentication: 'mschap2' });
    });

    await step('Server SSTP', async () => {
      const [sstp] = await this.exec('/interface/sstp-server/server/print');
      if (!sstp?.certificate || sstp.certificate === 'none') {
        throw new Error(`belum ada sertifikat. Di CHR jalankan: /certificate enable-ssl-certificate dns-name=${c.endpoint || 'vpn.domain-anda'} lalu "Siapkan CHR" lagi`);
      }
      await this.exec('/interface/sstp-server/server/set', { enabled: 'yes', port: String(c.sstpPort), 'default-profile': c.pppProfile, authentication: 'mschap2' });
    });

    const ensureRule = async (menu: string, comment: string, params: Record<string, string>) => {
      const exists = (await this.exec(`${menu}/print`)).some((r) => r.comment === comment);
      if (!exists) await this.exec(`${menu}/add`, { ...params, comment });
    };
    await step('Isolasi antar pelanggan', async () => {
      await ensureRule('/ip/firewall/filter', 'mikrotal-cloud: tolak antar router pelanggan', {
        chain: 'forward',
        'src-address': c.tunnelNetwork,
        'dst-address': c.tunnelNetwork,
        action: 'drop',
      });
      await ensureRule('/ip/firewall/filter', 'mikrotal-cloud: router pelanggan tidak boleh akses CHR', {
        chain: 'input',
        'src-address': c.tunnelNetwork,
        protocol: '!icmp',
        action: 'drop',
      });
    });
    await step('src-nat dari server MIKROTAL', async () => {
      await ensureRule('/ip/firewall/nat', 'mikrotal-cloud: server tampil sebagai IP tunnel', {
        chain: 'srcnat',
        'src-address': `!${c.tunnelNetwork}`,
        'dst-address': c.tunnelNetwork,
        action: 'src-nat',
        'to-addresses': serverIp,
      });
    });

    if (Object.keys(patch).length) this.platform.settings.update({ chr: patch as ChrSettings });
    this.platform.audit('system', 'chr.setup', '', { steps });
    return { version: res?.version ?? '', steps, readiness: this.readiness() };
  }

  async testChr() {
    const [identity] = await this.exec('/system/identity/print');
    const [res] = await this.exec('/system/resource/print');
    return { identity: identity?.name ?? '', version: res?.version ?? '', board: res?.['board-name'] ?? '' };
  }

  // ---- peer per router pelanggan ----
  peers(tenantId: number) {
    return this.platform.db.all<VpnPeerRow>('SELECT * FROM vpn_peers WHERE tenant_id = ? ORDER BY created_at', [tenantId]);
  }

  peer(tenantId: number, id: number) {
    const p = this.platform.db.get<VpnPeerRow>('SELECT * FROM vpn_peers WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    if (!p) throw new HttpError(404, 'Koneksi VPN tidak ditemukan');
    return p;
  }

  tunnelIps(tenantId: number) {
    return this.platform.db.all<{ tunnel_ip: string }>('SELECT tunnel_ip FROM vpn_peers WHERE tenant_id = ?', [tenantId]).map((r) => r.tunnel_ip);
  }

  setRouterId(peerId: number, routerId: number | null) {
    this.platform.db.run('UPDATE vpn_peers SET router_id = ? WHERE id = ?', [routerId, peerId]);
  }

  /** Buat koneksi VPN untuk satu router pelanggan: alokasi IP tunnel, daftarkan di CHR, siapkan akun API. */
  async create(tenant: TenantRow, input: { name: string; kind: VpnKind }) {
    const ready = this.readiness();
    if (!ready.available.includes(input.kind)) throw new HttpError(503, `VPN ${input.kind} belum siap: ${ready.kinds[input.kind].join(', ')}. Hubungi admin MIKROTAL Cloud.`);
    const c = this.chrSettings;
    const db = this.platform.db;
    const box = this.platform.box;
    const wg = input.kind === 'wireguard' ? wgKeyPair() : null;
    const apiPassword = randomToken(20);
    const pppSecret = input.kind === 'wireguard' ? '' : randomToken(20);
    // Alokasi IP dan simpan dalam satu transaksi agar dua permintaan bersamaan tidak mendapat IP yang sama
    const peerId = db.transaction(() => {
      const used = db.all<{ tunnel_ip: string }>('SELECT tunnel_ip FROM vpn_peers').map((r) => r.tunnel_ip);
      const ip = allocateTunnelIp(c.tunnelNetwork, used);
      return db.run(
        `INSERT INTO vpn_peers (tenant_id, name, kind, tunnel_ip, ppp_secret_enc, wg_private_enc, wg_public, wg_listen_port, api_user, api_password_enc, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenant.id,
          input.name,
          input.kind,
          ip,
          box.encrypt(pppSecret),
          box.encrypt(wg?.privateKey ?? ''),
          wg?.publicKey ?? '',
          wg ? crypto.randomInt(20000, 60000) : 0,
          `mtcloud-${randomToken(5).toLowerCase()}`,
          box.encrypt(apiPassword),
          new Date().toISOString(),
        ],
      ).lastId;
    });
    const pppUser = `${tenant.slug}-${peerId}`;
    db.run('UPDATE vpn_peers SET ppp_user = ? WHERE id = ?', [input.kind === 'wireguard' ? '' : pppUser, peerId]);
    const peer = this.peer(tenant.id, peerId);
    try {
      if (peer.kind === 'wireguard') {
        await this.exec('/interface/wireguard/peers/add', {
          interface: c.wgInterface,
          'public-key': peer.wg_public,
          'allowed-address': `${peer.tunnel_ip}/32`,
          comment: peerComment(tenant.slug, peer.id),
        });
      } else {
        await this.exec('/ppp/secret/add', {
          name: pppUser,
          password: pppSecret,
          service: peer.kind,
          profile: c.pppProfile,
          'remote-address': peer.tunnel_ip,
          comment: peerComment(tenant.slug, peer.id),
        });
      }
    } catch (err) {
      db.run('DELETE FROM vpn_peers WHERE id = ?', [peerId]);
      throw err instanceof HttpError ? err : new HttpError(502, `Gagal mendaftarkan router di server VPN: ${(err as Error).message}`);
    }
    this.platform.audit(tenant.slug, 'vpn.create', peer.tunnel_ip, { name: peer.name, kind: peer.kind });
    return peer;
  }

  /** Kredensial API yang dipakai aplikasi pelanggan untuk masuk ke router lewat tunnel. */
  apiCredentials(peer: VpnPeerRow) {
    return { host: peer.tunnel_ip, port: 8728, username: peer.api_user, password: this.platform.box.decrypt(peer.api_password_enc) };
  }

  script(peer: VpnPeerRow) {
    const c = this.chrSettings;
    const box = this.platform.box;
    return routerScript({
      kind: peer.kind,
      routerName: peer.name,
      tunnelIp: peer.tunnel_ip,
      serverIp: serverTunnelIp(c.tunnelNetwork),
      endpoint: c.endpoint,
      apiUser: peer.api_user,
      apiPassword: box.decrypt(peer.api_password_enc),
      wg: peer.kind === 'wireguard' ? { privateKey: box.decrypt(peer.wg_private_enc), listenPort: peer.wg_listen_port, serverPublicKey: c.wgPublicKey, serverPort: c.wgPort } : undefined,
      ppp:
        peer.kind === 'wireguard'
          ? undefined
          : { user: peer.ppp_user, secret: box.decrypt(peer.ppp_secret_enc), ipsecSecret: c.ipsecSecretEnc ? box.decrypt(c.ipsecSecretEnc) : undefined, sstpPort: c.sstpPort },
    });
  }

  /** Hapus koneksi di CHR (sesi aktif diputus). */
  async remove(tenant: TenantRow, peerId: number) {
    const peer = this.peer(tenant.id, peerId);
    const comment = peerComment(tenant.slug, peer.id);
    if (peer.kind === 'wireguard') {
      const items = (await this.exec('/interface/wireguard/peers/print')).filter((p) => p.comment === comment);
      for (const it of items) await this.exec('/interface/wireguard/peers/remove', { '.id': it['.id'] });
    } else {
      const items = (await this.exec('/ppp/secret/print')).filter((p) => p.comment === comment);
      for (const it of items) await this.exec('/ppp/secret/remove', { '.id': it['.id'] });
      const active = (await this.exec('/ppp/active/print')).filter((a) => a.name === peer.ppp_user);
      for (const a of active) await this.exec('/ppp/active/remove', { '.id': a['.id'] });
    }
    this.platform.db.run('DELETE FROM vpn_peers WHERE id = ?', [peer.id]);
    this.platform.audit(tenant.slug, 'vpn.remove', peer.tunnel_ip, { name: peer.name });
    return peer;
  }

  /** Hapus semua koneksi VPN pelanggan di CHR (mis. akun dihapus). Kesalahan per item diabaikan. */
  async removeAll(tenant: TenantRow) {
    for (const p of this.peers(tenant.id)) await this.remove(tenant, p.id).catch(() => undefined);
  }

  /** Status tersambung tiap koneksi menurut CHR. */
  async status(tenantId: number) {
    const peers = this.peers(tenantId);
    const out = new Map<number, { online: boolean; lastSeen: string | null; detail: string }>();
    if (!peers.length) return out;
    const now = Date.now();
    let wg: RosRow[] = [];
    let ppp: RosRow[] = [];
    try {
      [wg, ppp] = await Promise.all([
        peers.some((p) => p.kind === 'wireguard') ? this.exec('/interface/wireguard/peers/print').catch(() => []) : [],
        peers.some((p) => p.kind !== 'wireguard') ? this.exec('/ppp/active/print') : [],
      ]);
    } catch (err) {
      for (const p of peers) out.set(p.id, { online: false, lastSeen: p.last_seen_at, detail: (err as Error).message });
      return out;
    }
    for (const p of peers) {
      let online = false;
      let detail = 'Belum tersambung. Tempel skrip ke terminal router.';
      if (p.kind === 'wireguard') {
        const item = wg.find((w) => w['public-key'] === p.wg_public);
        const hs = item?.['last-handshake'];
        if (hs) {
          const secs = parseDuration(hs);
          online = secs <= WG_ONLINE_SECONDS;
          detail = online ? `Handshake ${hs} lalu` : `Handshake terakhir ${hs} lalu`;
        }
      } else {
        const a = ppp.find((x) => x.name === p.ppp_user);
        if (a) {
          online = true;
          detail = `Tersambung ${a.uptime ?? ''} dari ${a['caller-id'] ?? '-'}`.trim();
        }
      }
      if (online) this.platform.db.run('UPDATE vpn_peers SET last_seen_at = ? WHERE id = ?', [new Date(now).toISOString(), p.id]);
      out.set(p.id, { online, lastSeen: online ? new Date(now).toISOString() : p.last_seen_at, detail });
    }
    return out;
  }

  close() {
    this.resetConnection();
  }
}
