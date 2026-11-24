import crypto from 'node:crypto';
import type { DB } from '../db/index.js';
import { defaultPortalConfig, portalConfigSchema, type PortalConfig, type PriceItem } from '../lib/portal/config.js';
import { renderPortalFiles, speedText, type RenderContext } from '../lib/portal/render.js';
import type { RosRow } from '../lib/routeros/types.js';
import type { RouterManager } from './routers.js';
import type { SettingsService } from './settings.js';
import { HttpError } from './vouchers.js';

export const PORTAL_DIR_NAME = 'mikrotal-portal';
export const PORTAL_COMMENT = 'MIKROTAL-PORTAL';
const TOKEN_TTL_MS = 10 * 60_000;
const WA_HOSTS = ['wa.me', '*.whatsapp.com', '*.whatsapp.net'];

export interface PortalRecord {
  router_id: number;
  config: string;
  updated_at: string;
  profile: string | null;
  installed_dir: string | null;
  previous_dir: string | null;
  base_url: string | null;
  installed_at: string | null;
  installed_by: string | null;
  prices_sig: string | null;
}

export interface InstallOptions {
  profile: string;
  baseUrl: string;
  allowWhatsapp: boolean;
  /** fetch: router mengunduh dari MIKROTAL; ftp: MIKROTAL mengunggah ke router; auto: coba fetch lalu FTP. */
  method?: 'auto' | 'fetch' | 'ftp';
}

/** Folder portal: di samping folder hotspot yang sekarang dipakai, mis. flash/hotspot → flash/mikrotal-portal. */
export function portalDirFor(current: string) {
  const cur = (current || 'hotspot').replace(/\/+$/, '');
  if (cur.split('/').pop() === PORTAL_DIR_NAME) return cur;
  const i = cur.lastIndexOf('/');
  return `${i >= 0 ? cur.slice(0, i + 1) : ''}${PORTAL_DIR_NAME}`;
}

export class PortalService {
  private tokens = new Map<string, { files: Map<string, { data: Buffer; type: string }>; expires: number }>();
  /** Kecepatan (rate-limit) profil dari router, disimpan sebentar. Harga selalu dibaca langsung dari database. */
  private rateCache = new Map<number, { at: number; rate: Map<string, string> }>();
  private refreshTimers = new Map<number, NodeJS.Timeout>();
  /** Hasil pembaruan harga otomatis terakhir per router (untuk ditampilkan di halaman portal). */
  private lastRefresh = new Map<number, { at: string; ok: boolean; message: string }>();

  constructor(
    private readonly db: DB,
    private readonly routers: RouterManager,
    private readonly settings: SettingsService,
  ) {}

  record(routerId: number) {
    return this.db.get<PortalRecord>('SELECT * FROM hotspot_portals WHERE router_id = ?', [routerId]);
  }

  config(routerId: number): PortalConfig {
    const r = this.record(routerId);
    if (!r) return defaultPortalConfig();
    const parsed = portalConfigSchema.safeParse(JSON.parse(r.config));
    return parsed.success ? parsed.data : defaultPortalConfig();
  }

  save(routerId: number, config: PortalConfig) {
    this.routers.require(routerId);
    this.db.run(
      `INSERT INTO hotspot_portals (router_id, config, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(router_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
      [routerId, JSON.stringify(config), new Date().toISOString()],
    );
    return config;
  }

  installState(routerId: number) {
    const r = this.record(routerId);
    if (!r?.installed_dir) return null;
    return {
      profile: r.profile,
      dir: r.installed_dir,
      previousDir: r.previous_dir,
      baseUrl: r.base_url,
      at: r.installed_at,
      by: r.installed_by,
      pricesStale: this.pricesStale(routerId, r),
      autoRefresh: this.lastRefresh.get(routerId) ?? null,
    };
  }

  private priceMetas(routerId: number) {
    return this.db.all<any>('SELECT * FROM profile_meta WHERE router_id = ? AND price > 0 ORDER BY price, profile', [routerId]);
  }

  /** Sidik harga yang tampil di portal (harga, masa aktif, batas, warna per profil), tanpa perlu menghubungi router. */
  pricesSig(routerId: number) {
    const rows = this.priceMetas(routerId).map((m) => [m.profile, m.price, m.validity, m.time_limit, m.data_limit, m.color]);
    return crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex');
  }

  /** Portal terpasang memuat harga lama: harga di MIKROTAL sudah diubah sejak terakhir dipasang. */
  private pricesStale(routerId: number, r = this.record(routerId)) {
    if (!r?.installed_dir) return false;
    // dipasang oleh versi lama (sidik belum dicatat): harga di router tidak bisa dipastikan sama
    return r.prices_sig !== this.pricesSig(routerId);
  }

  /** Daftar harga dari harga yang disimpan MIKROTAL + kecepatan profil di router. Router mati → tanpa kecepatan. */
  async prices(routerId: number): Promise<PriceItem[]> {
    let cached = this.rateCache.get(routerId);
    if (!cached || Date.now() - cached.at > 30_000) {
      let rate = new Map<string, string>();
      try {
        const profiles = await this.routers.exec(routerId, '/ip/hotspot/user/profile/print', { '.proplist': 'name,rate-limit' });
        rate = new Map(profiles.map((p) => [p.name, p['rate-limit'] ?? '']));
      } catch {
        /* router tidak terjangkau: kecepatan tidak ditampilkan */
      }
      cached = { at: Date.now(), rate };
      if (rate.size) this.rateCache.set(routerId, cached);
    }
    const rate = cached.rate;
    return this.priceMetas(routerId)
      .filter((m) => rate.size === 0 || rate.has(m.profile))
      .map((m) => ({ profile: m.profile, price: m.price, validity: m.validity, timeLimit: m.time_limit, dataLimit: m.data_limit, speed: speedText(rate.get(m.profile) ?? ''), color: m.color }));
  }

  /**
   * Harga profil berubah: perbarui portal yang sudah terpasang di router agar halaman login ikut menampilkan harga baru.
   * Ditunda sebentar supaya beberapa perubahan beruntun cukup dipasang sekali.
   */
  schedulePriceRefresh(routerId: number, actor: string, delayMs = 3000) {
    this.rateCache.delete(routerId);
    const r = this.record(routerId);
    if (!r?.installed_dir || !r.profile || !r.base_url) return;
    clearTimeout(this.refreshTimers.get(routerId));
    const t = setTimeout(() => {
      this.refreshTimers.delete(routerId);
      this.refreshPrices(routerId, actor).catch(() => undefined);
    }, delayMs);
    t.unref?.();
    this.refreshTimers.set(routerId, t);
  }

  async refreshPrices(routerId: number, actor: string) {
    const r = this.record(routerId);
    if (!r?.installed_dir || !r.profile || !r.base_url || !this.pricesStale(routerId, r)) return null;
    try {
      await this.install(routerId, { profile: r.profile, baseUrl: r.base_url, allowWhatsapp: false, method: 'auto' }, actor);
      this.lastRefresh.set(routerId, { at: new Date().toISOString(), ok: true, message: 'Harga baru sudah dipasang di halaman login router' });
      return true;
    } catch (err) {
      this.lastRefresh.set(routerId, { at: new Date().toISOString(), ok: false, message: (err as Error).message });
      return false;
    }
  }

  async context(routerId: number, config: PortalConfig, baseUrl: string, inlineAssets = false): Promise<RenderContext> {
    const s = this.settings.get();
    return { config, brandName: s.brand.name, brandPhone: s.brand.phone, currency: s.brand.currency || 'IDR', prices: await this.prices(routerId), baseUrl, inlineAssets };
  }

  /** Alamat MIKROTAL yang dipakai router untuk mengunduh berkas dan pelanggan untuk membuka /cek. */
  async suggestBaseUrl(routerId: number, port: number) {
    const p = this.settings.get().pppoe;
    if (p.portalAddress) return `http://${p.portalAddress}${p.portalPort && p.portalPort !== 80 ? `:${p.portalPort}` : ''}`;
    const ip = await this.routers.localAddress(routerId).catch(() => undefined);
    return ip ? `http://${ip}:${port}` : '';
  }

  async hotspotInfo(routerId: number) {
    const [servers, profiles] = await Promise.all([
      this.routers.exec(routerId, '/ip/hotspot/print', { '.proplist': 'name,interface,profile,disabled' }),
      this.routers.exec(routerId, '/ip/hotspot/profile/print', { '.proplist': '.id,name,html-directory,dns-name,hotspot-address' }),
    ]);
    return {
      servers: servers.map((s) => ({ name: s.name, interface: s.interface ?? '', profile: s.profile ?? 'default', disabled: s.disabled === 'true' })),
      profiles: profiles.map((p) => ({ name: p.name, htmlDirectory: p['html-directory'] ?? '', dnsName: p['dns-name'] ?? '', address: p['hotspot-address'] ?? '' })),
    };
  }

  private registerFiles(files: { name: string; data: Buffer; type: string }[]) {
    const now = Date.now();
    for (const [k, v] of this.tokens) if (v.expires < now) this.tokens.delete(k);
    const token = crypto.randomBytes(16).toString('hex');
    this.tokens.set(token, { files: new Map(files.map((f) => [f.name, { data: f.data, type: f.type }])), expires: now + TOKEN_TTL_MS });
    return token;
  }

  takeFile(token: string, name: string) {
    const t = this.tokens.get(token);
    if (!t || t.expires < Date.now()) return undefined;
    return t.files.get(name);
  }

  /**
   * Pasang portal ke router tanpa menimpa folder hotspot lama:
   * 1) html-directory profil diarahkan ke folder baru (router mengisinya dengan halaman bawaan),
   * 2) router mengunduh halaman MIKROTAL dengan /tool/fetch,
   * 3) ukuran berkas diverifikasi; bila gagal, html-directory dikembalikan.
   */
  async install(routerId: number, opts: InstallOptions, actor: string) {
    const router = this.routers.require(routerId);
    const config = this.config(routerId);
    const baseUrl = opts.baseUrl.replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+$/.test(baseUrl)) throw new HttpError(400, 'Alamat server MIKROTAL tidak valid. Contoh: http://192.168.88.10:8080');
    const host = new URL(baseUrl).hostname;

    const profiles = await this.routers.exec(routerId, '/ip/hotspot/profile/print', { '.proplist': '.id,name,html-directory' });
    const prof = profiles.find((p) => p.name === opts.profile);
    if (!prof) throw new HttpError(400, `Profil hotspot "${opts.profile}" tidak ada di router`);
    const current = prof['html-directory'] || 'hotspot';
    const rec = this.record(routerId);
    const target = portalDirFor(current);
    // pasang ulang: folder asal tetap yang tercatat saat pemasangan pertama
    const previous = current === target ? rec?.previous_dir || 'hotspot' : current;

    const pricesSig = this.pricesSig(routerId);
    const files = renderPortalFiles(await this.context(routerId, config, baseUrl));
    const token = this.registerFiles(files);
    const steps: string[] = [];
    const dstDir = target.replace(/^\/+/, '');
    let switched = false;
    try {
      if (current !== target) {
        await this.routers.exec(routerId, '/ip/hotspot/profile/set', { '.id': prof['.id'], 'html-directory': target });
        switched = true;
        steps.push(`Profil ${opts.profile}: folder halaman ${current} → ${target}`);
      }
      const method = opts.method ?? 'auto';
      let fetchError: string | null = null;
      if (method !== 'ftp') {
        try {
          for (const f of files) {
            try {
              await this.routers.exec(routerId, '/tool/fetch', { url: `${baseUrl}/api/portal-files/${token}/${f.name}`, 'dst-path': `${dstDir}/${f.name}`, mode: 'http' });
            } catch (err) {
              throw new Error(`Router gagal mengunduh ${f.name} dari ${baseUrl}: ${(err as Error).message}`);
            }
          }
          steps.push(`${files.length} berkas diunduh router dari ${baseUrl} ke ${dstDir}`);
        } catch (err) {
          fetchError = (err as Error).message;
          steps.push(fetchError);
          steps.push(...(await this.diagnoseReach(routerId, host)));
          if (method === 'fetch') {
            throw new HttpError(502, `${fetchError}. Pilih cara pasang "Unggah lewat FTP", atau pastikan ${router.name} bisa menjangkau ${host}.`);
          }
        }
      }
      if (method === 'ftp' || fetchError) {
        const svc = (await this.routers.exec(routerId, '/ip/service/print', { '.proplist': 'name,port,disabled,address' })).find((x) => x.name === 'ftp');
        if (!svc || svc.disabled === 'true') {
          throw new HttpError(
            502,
            `${fetchError ? 'Router tidak bisa mengunduh dari MIKROTAL, dan ' : ''}layanan FTP di ${router.name} nonaktif. Aktifkan "ftp" di Semua Menu Router → IP service (isi address dengan IP komputer MIKROTAL agar aman), lalu pasang lagi.`,
          );
        }
        try {
          await this.routers.uploadFiles(routerId, Number(svc.port) || 21, files.map((f) => ({ path: `${dstDir}/${f.name}`, data: f.data })));
        } catch (err) {
          throw new HttpError(502, `Unggah lewat FTP ke ${router.name} gagal: ${(err as Error).message}`);
        }
        steps.push(`${files.length} berkas diunggah MIKROTAL ke ${dstDir} lewat FTP (port ${svc.port || 21})`);
      }

      const onRouter = await this.routers.exec(routerId, '/file/print', { '.proplist': 'name,size' });
      const byName = new Map<string, RosRow>(onRouter.map((r) => [r.name.replace(/^\/+/, ''), r]));
      const bad = files.filter((f) => {
        const r = byName.get(`${dstDir}/${f.name}`);
        if (!r) return true;
        const size = Number(r.size);
        return Number.isFinite(size) && size > 0 && size !== f.data.length;
      });
      if (bad.length) throw new HttpError(502, `Verifikasi gagal: ${bad.map((f) => f.name).join(', ')} tidak ada atau ukurannya tidak sesuai di ${dstDir}.`);
      steps.push('Verifikasi ukuran berkas di router: cocok');
    } catch (err) {
      if (switched) {
        await this.routers.exec(routerId, '/ip/hotspot/profile/set', { '.id': prof['.id'], 'html-directory': current }).catch(() => undefined);
        steps.push(`Dibatalkan: folder halaman dikembalikan ke ${current}`);
      }
      this.tokens.delete(token);
      if (err instanceof HttpError) throw Object.assign(err, { steps });
      throw err;
    }
    this.tokens.delete(token);

    // Walled garden: halaman cek voucher dan (opsional) WhatsApp bisa dibuka sebelum login
    const warnings: string[] = [];
    try {
      if (config.cekVoucher || config.pppoeTopup) {
        const ips = await this.routers.exec(routerId, '/ip/hotspot/walled-garden/ip/print', { '.proplist': 'dst-address,comment' });
        if (!ips.some((r) => (r['dst-address'] ?? '').split('/')[0] === host)) {
          await this.routers.exec(routerId, '/ip/hotspot/walled-garden/ip/add', { 'dst-address': host, action: 'accept', comment: PORTAL_COMMENT });
          steps.push(`Walled garden: ${host} bisa dibuka sebelum login (cek voucher)`);
        }
      }
      if (opts.allowWhatsapp) {
        const wg = await this.routers.exec(routerId, '/ip/hotspot/walled-garden/print', { '.proplist': 'dst-host' });
        const have = new Set(wg.map((r) => r['dst-host']));
        const add = WA_HOSTS.filter((d) => !have.has(d));
        for (const d of add) await this.routers.exec(routerId, '/ip/hotspot/walled-garden/add', { 'dst-host': d, action: 'allow', comment: PORTAL_COMMENT });
        if (add.length) steps.push(`Walled garden: WhatsApp (${add.join(', ')}) bisa dibuka sebelum login`);
      }
    } catch (err) {
      warnings.push(`Walled garden tidak bisa diatur: ${(err as Error).message}`);
    }

    const now = new Date().toISOString();
    this.db.run(
      'UPDATE hotspot_portals SET profile = ?, installed_dir = ?, previous_dir = ?, base_url = ?, installed_at = ?, installed_by = ?, prices_sig = ? WHERE router_id = ?',
      [opts.profile, target, previous, baseUrl, now, actor, pricesSig, routerId],
    );
    this.lastRefresh.delete(routerId);
    return { dir: target, previousDir: previous, files: files.map((f) => ({ name: f.name, size: f.data.length })), steps, warnings };
  }

  /** Penjelasan kenapa router tidak menjangkau server MIKROTAL: hasil ping dan alamat IP router. */
  async diagnoseReach(routerId: number, host: string) {
    const out: string[] = [];
    try {
      const ping = await this.routers.exec(routerId, '/ping', { address: host, count: '2' });
      const ok = ping.some((p) => Number(p.received ?? 0) > 0 && !p.status);
      out.push(ok ? `Diagnosis: router bisa ping ${host}, jadi kemungkinan port web MIKROTAL diblokir firewall komputer.` : `Diagnosis: router tidak bisa ping ${host} (${ping.find((p) => p.status)?.status ?? 'tidak ada balasan'}).`);
    } catch (err) {
      out.push(`Diagnosis: ping dari router gagal (${(err as Error).message}).`);
    }
    try {
      const addrs = await this.routers.exec(routerId, '/ip/address/print', { '.proplist': 'address,interface,disabled' });
      const list = addrs.filter((a) => a.disabled !== 'true').map((a) => `${a.address} (${a.interface})`);
      if (list.length) out.push(`Alamat IP di router: ${list.slice(0, 8).join(', ')}${list.length > 8 ? ', ...' : ''}.`);
    } catch {
      /* abaikan */
    }
    const local = await this.routers.localAddress(routerId).catch(() => undefined);
    if (local && local !== host) out.push(`MIKROTAL tersambung ke router dari IP ${local}, berbeda dengan ${host}. Bila komputer MIKROTAL di belakang router/ONT lain (NAT), router tidak bisa menghubunginya: pakai cara pasang lewat FTP.`);
    return out;
  }

  /** Kembalikan profil hotspot ke folder halaman sebelum MIKROTAL dipasang. Berkas portal tetap disimpan. */
  async rollback(routerId: number) {
    const rec = this.record(routerId);
    if (!rec?.installed_dir || !rec.profile) throw new HttpError(400, 'Portal MIKROTAL belum pernah dipasang di router ini');
    const profiles = await this.routers.exec(routerId, '/ip/hotspot/profile/print', { '.proplist': '.id,name,html-directory' });
    const prof = profiles.find((p) => p.name === rec.profile);
    if (!prof) throw new HttpError(400, `Profil hotspot "${rec.profile}" sudah tidak ada di router`);
    const back = rec.previous_dir || 'hotspot';
    await this.routers.exec(routerId, '/ip/hotspot/profile/set', { '.id': prof['.id'], 'html-directory': back });
    this.db.run('UPDATE hotspot_portals SET installed_dir = NULL, installed_at = NULL WHERE router_id = ?', [routerId]);
    return { dir: back };
  }
}
